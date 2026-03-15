import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GcpSmProvider, buildSecretId } from '../../src/providers/gcp-sm.js';

const mockClient = {
    accessSecretVersion: vi.fn(),
    getSecret: vi.fn(),
    createSecret: vi.fn(),
    addSecretVersion: vi.fn(),
    deleteSecret: vi.fn(),
    listSecrets: vi.fn()
};

vi.mock('@google-cloud/secret-manager', () => {
    return {
        SecretManagerServiceClient: class {
            accessSecretVersion = mockClient.accessSecretVersion;
            getSecret = mockClient.getSecret;
            createSecret = mockClient.createSecret;
            addSecretVersion = mockClient.addSecretVersion;
            deleteSecret = mockClient.deleteSecret;
            listSecrets = mockClient.listSecrets;
        }
    };
});

describe('GcpSmProvider', () => {
    let provider: GcpSmProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new GcpSmProvider('myapp', 'my-project');
    });

    describe('get', () => {
        it('returns secret value from latest version', async () => {
            mockClient.accessSecretVersion.mockResolvedValue([
                { payload: { data: Buffer.from('s3cret') } }
            ]);

            const value = await provider.get('dev', 'db/password');

            expect(mockClient.accessSecretVersion).toHaveBeenCalledWith({
                name: 'projects/my-project/secrets/myapp__dev__db__password/versions/latest'
            });
            expect(value).toBe('s3cret');
        });

        it('throws descriptive error when secret not found', async () => {
            mockClient.accessSecretVersion.mockRejectedValue({ code: 5 });

            await expect(provider.get('dev', 'db/password')).rejects.toThrow(
                /Secret "db\/password" not found in environment "dev"/
            );
        });

        it('re-throws non-NOT_FOUND errors', async () => {
            mockClient.accessSecretVersion.mockRejectedValue(new Error('permission denied'));

            await expect(provider.get('dev', 'db/password')).rejects.toThrow('permission denied');
        });
    });

    describe('set', () => {
        it('adds version to existing secret', async () => {
            mockClient.getSecret.mockResolvedValue([{}]);
            mockClient.addSecretVersion.mockResolvedValue([{}]);

            await provider.set('dev', 'db/password', 'newvalue');

            expect(mockClient.getSecret).toHaveBeenCalledWith({
                name: 'projects/my-project/secrets/myapp__dev__db__password'
            });
            expect(mockClient.createSecret).not.toHaveBeenCalled();
            expect(mockClient.addSecretVersion).toHaveBeenCalledWith({
                parent: 'projects/my-project/secrets/myapp__dev__db__password',
                payload: { data: Buffer.from('newvalue', 'utf-8') }
            });
        });

        it('creates secret before adding version when it does not exist', async () => {
            mockClient.getSecret.mockRejectedValue({ code: 5 });
            mockClient.createSecret.mockResolvedValue([{}]);
            mockClient.addSecretVersion.mockResolvedValue([{}]);

            await provider.set('dev', 'db/password', 'newvalue');

            expect(mockClient.createSecret).toHaveBeenCalledWith({
                parent: 'projects/my-project',
                secretId: 'myapp__dev__db__password',
                secret: { replication: { automatic: {} } }
            });
            expect(mockClient.addSecretVersion).toHaveBeenCalled();
        });
    });

    describe('delete', () => {
        it('deletes the secret resource', async () => {
            mockClient.deleteSecret.mockResolvedValue([{}]);

            await provider.delete('dev', 'db/password');

            expect(mockClient.deleteSecret).toHaveBeenCalledWith({
                name: 'projects/my-project/secrets/myapp__dev__db__password'
            });
        });

        it('throws descriptive error when secret not found', async () => {
            mockClient.deleteSecret.mockRejectedValue({ code: 5 });

            await expect(provider.delete('dev', 'db/password')).rejects.toThrow(
                /Secret "db\/password" not found in environment "dev"/
            );
        });
    });

    describe('list', () => {
        it('returns paths for matching environment', async () => {
            mockClient.listSecrets.mockResolvedValue([
                [
                    { name: 'projects/my-project/secrets/myapp__dev__db__password' },
                    { name: 'projects/my-project/secrets/myapp__dev__db__host' },
                    { name: 'projects/my-project/secrets/myapp__staging__db__password' }
                ]
            ]);

            const paths = await provider.list('dev');

            expect(paths).toEqual(['db/password', 'db/host']);
        });

        it('filters by prefix', async () => {
            mockClient.listSecrets.mockResolvedValue([
                [
                    { name: 'projects/my-project/secrets/myapp__dev__db__password' },
                    { name: 'projects/my-project/secrets/myapp__dev__db__host' },
                    { name: 'projects/my-project/secrets/myapp__dev__cache__url' }
                ]
            ]);

            const paths = await provider.list('dev', 'db');

            expect(paths).toEqual(['db/password', 'db/host']);
        });

        it('returns empty array when no secrets match', async () => {
            mockClient.listSecrets.mockResolvedValue([[]]);

            const paths = await provider.list('dev');

            expect(paths).toEqual([]);
        });
    });

    describe('ref', () => {
        it('returns the GCP secret ID with project name', () => {
            expect(provider.ref('prod', 'database/password')).toBe(
                'myapp__prod__database__password'
            );
        });

        it('handles deeply nested paths', () => {
            expect(provider.ref('dev', 'a/b/c/d')).toBe('myapp__dev__a__b__c__d');
        });
    });

    describe('project isolation', () => {
        let providerA: GcpSmProvider;
        let providerB: GcpSmProvider;

        beforeEach(() => {
            providerA = new GcpSmProvider('project-a', 'my-project');
            providerB = new GcpSmProvider('project-b', 'my-project');
        });

        it('produces different keys for different project names', () => {
            expect(providerA.ref('dev', 'db/password')).toBe('project-a__dev__db__password');
            expect(providerB.ref('dev', 'db/password')).toBe('project-b__dev__db__password');
        });

        it('sends project-scoped key on get', async () => {
            mockClient.accessSecretVersion.mockResolvedValue([
                { payload: { data: Buffer.from('val') } }
            ]);

            await providerA.get('dev', 'db/password');

            expect(mockClient.accessSecretVersion).toHaveBeenCalledWith({
                name: 'projects/my-project/secrets/project-a__dev__db__password/versions/latest'
            });
        });

        it('sends project-scoped key on set', async () => {
            mockClient.getSecret.mockResolvedValue([{}]);
            mockClient.addSecretVersion.mockResolvedValue([{}]);

            await providerB.set('dev', 'db/password', 'val');

            expect(mockClient.getSecret).toHaveBeenCalledWith({
                name: 'projects/my-project/secrets/project-b__dev__db__password'
            });
        });

        it('sends project-scoped key on delete', async () => {
            mockClient.deleteSecret.mockResolvedValue([{}]);

            await providerA.delete('dev', 'db/password');

            expect(mockClient.deleteSecret).toHaveBeenCalledWith({
                name: 'projects/my-project/secrets/project-a__dev__db__password'
            });
        });

        it('scopes list filter by project name', async () => {
            mockClient.listSecrets.mockResolvedValue([
                [
                    { name: 'projects/my-project/secrets/project-a__dev__db__password' },
                    { name: 'projects/my-project/secrets/project-b__dev__db__password' }
                ]
            ]);

            const paths = await providerA.list('dev');

            expect(paths).toEqual(['db/password']);
        });
    });
});

describe('buildSecretId', () => {
    it('encodes name, env and path with double underscores', () => {
        expect(buildSecretId('myapp', 'dev', 'db/password')).toBe('myapp__dev__db__password');
    });

    it('handles deeply nested paths', () => {
        expect(buildSecretId('myapp', 'prod', 'a/b/c/d')).toBe('myapp__prod__a__b__c__d');
    });

    it('throws when secret ID exceeds 255 characters', () => {
        const longPath = 'a'.repeat(300);
        expect(() => buildSecretId('myapp', 'dev', longPath)).toThrow(
            /exceeds GCP's 255-character limit/
        );
    });
});
