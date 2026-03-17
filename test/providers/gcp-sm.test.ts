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
        it('value is retrievable after set to existing secret', async () => {
            const store = new Map<string, string>();

            mockClient.getSecret.mockImplementation(({ name }: { name: string }) => {
                const id = name.split('/secrets/')[1];
                return store.has(id) ? Promise.resolve([{}]) : Promise.reject({ code: 5 });
            });
            mockClient.createSecret.mockImplementation(({ secretId }: { secretId: string }) => {
                store.set(secretId, '');
                return Promise.resolve([{}]);
            });
            mockClient.addSecretVersion.mockImplementation(
                ({ parent, payload }: { parent: string; payload: { data: Buffer } }) => {
                    const id = parent.split('/secrets/')[1];
                    store.set(id, payload.data.toString('utf-8'));
                    return Promise.resolve([{}]);
                }
            );
            mockClient.accessSecretVersion.mockImplementation(({ name }: { name: string }) => {
                const id = name.split('/secrets/')[1].replace('/versions/latest', '');
                const val = store.get(id);
                if (val === undefined) return Promise.reject({ code: 5 });
                return Promise.resolve([{ payload: { data: Buffer.from(val) } }]);
            });

            await provider.set('dev', 'db/password', 'newvalue');
            const result = await provider.get('dev', 'db/password');

            expect(result).toBe('newvalue');
        });

        it('creates secret before adding version when it does not exist', async () => {
            const store = new Map<string, string>();

            mockClient.getSecret.mockImplementation(({ name }: { name: string }) => {
                const id = name.split('/secrets/')[1];
                return store.has(id) ? Promise.resolve([{}]) : Promise.reject({ code: 5 });
            });
            mockClient.createSecret.mockImplementation(({ secretId }: { secretId: string }) => {
                store.set(secretId, '');
                return Promise.resolve([{}]);
            });
            mockClient.addSecretVersion.mockImplementation(
                ({ parent, payload }: { parent: string; payload: { data: Buffer } }) => {
                    const id = parent.split('/secrets/')[1];
                    store.set(id, payload.data.toString('utf-8'));
                    return Promise.resolve([{}]);
                }
            );
            mockClient.accessSecretVersion.mockImplementation(({ name }: { name: string }) => {
                const id = name.split('/secrets/')[1].replace('/versions/latest', '');
                const val = store.get(id);
                if (val === undefined) return Promise.reject({ code: 5 });
                return Promise.resolve([{ payload: { data: Buffer.from(val) } }]);
            });

            await provider.set('dev', 'db/password', 'newvalue');

            expect(mockClient.createSecret).toHaveBeenCalled();

            const result = await provider.get('dev', 'db/password');
            expect(result).toBe('newvalue');
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

        it('set and get are scoped: project-a value is not visible to project-b', async () => {
            const store = new Map<string, string>();

            mockClient.getSecret.mockImplementation(({ name }: { name: string }) => {
                const id = name.split('/secrets/')[1];
                return store.has(id) ? Promise.resolve([{}]) : Promise.reject({ code: 5 });
            });
            mockClient.createSecret.mockImplementation(({ secretId }: { secretId: string }) => {
                store.set(secretId, '');
                return Promise.resolve([{}]);
            });
            mockClient.addSecretVersion.mockImplementation(
                ({ parent, payload }: { parent: string; payload: { data: Buffer } }) => {
                    const id = parent.split('/secrets/')[1];
                    store.set(id, payload.data.toString('utf-8'));
                    return Promise.resolve([{}]);
                }
            );
            mockClient.accessSecretVersion.mockImplementation(({ name }: { name: string }) => {
                const id = name.split('/secrets/')[1].replace('/versions/latest', '');
                const val = store.get(id);
                if (val === undefined) return Promise.reject({ code: 5 });
                return Promise.resolve([{ payload: { data: Buffer.from(val) } }]);
            });

            await providerA.set('dev', 'db/password', 'secret-a');

            await expect(providerB.get('dev', 'db/password')).rejects.toThrow(
                /not found in environment/
            );
        });

        it('set and get round-trip is scoped per project', async () => {
            const store = new Map<string, string>();

            mockClient.getSecret.mockImplementation(({ name }: { name: string }) => {
                const id = name.split('/secrets/')[1];
                return store.has(id) ? Promise.resolve([{}]) : Promise.reject({ code: 5 });
            });
            mockClient.createSecret.mockImplementation(({ secretId }: { secretId: string }) => {
                store.set(secretId, '');
                return Promise.resolve([{}]);
            });
            mockClient.addSecretVersion.mockImplementation(
                ({ parent, payload }: { parent: string; payload: { data: Buffer } }) => {
                    const id = parent.split('/secrets/')[1];
                    store.set(id, payload.data.toString('utf-8'));
                    return Promise.resolve([{}]);
                }
            );
            mockClient.accessSecretVersion.mockImplementation(({ name }: { name: string }) => {
                const id = name.split('/secrets/')[1].replace('/versions/latest', '');
                const val = store.get(id);
                if (val === undefined) return Promise.reject({ code: 5 });
                return Promise.resolve([{ payload: { data: Buffer.from(val) } }]);
            });

            await providerA.set('dev', 'db/password', 'value-a');
            await providerB.set('dev', 'db/password', 'value-b');

            expect(await providerA.get('dev', 'db/password')).toBe('value-a');
            expect(await providerB.get('dev', 'db/password')).toBe('value-b');
        });

        it('list only returns secrets belonging to the queried project', async () => {
            mockClient.listSecrets.mockResolvedValue([
                [
                    { name: 'projects/my-project/secrets/project-a__dev__db__password' },
                    { name: 'projects/my-project/secrets/project-b__dev__db__password' }
                ]
            ]);

            const paths = await providerA.list('dev');

            expect(paths).toEqual(['db/password']);
            expect(paths).not.toContain('project-b__dev__db__password');
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
