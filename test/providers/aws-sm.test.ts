import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AwsSmProvider, buildSecretName } from '../../src/providers/aws-sm.js';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-secrets-manager', () => ({
    SecretsManagerClient: class {
        send = mockSend;
    },
    GetSecretValueCommand: class {
        constructor(public input: unknown) {}
    },
    PutSecretValueCommand: class {
        constructor(public input: unknown) {}
    },
    CreateSecretCommand: class {
        constructor(public input: unknown) {}
    },
    DeleteSecretCommand: class {
        constructor(public input: unknown) {}
    },
    ListSecretsCommand: class {
        constructor(public input: unknown) {}
    }
}));

describe('AwsSmProvider', () => {
    let provider: AwsSmProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new AwsSmProvider({ name: 'myapp' });
    });

    describe('get', () => {
        it('returns SecretString from AWS response', async () => {
            mockSend.mockResolvedValue({ SecretString: 's3cret' });

            const value = await provider.get('dev', 'db/password');

            expect(mockSend).toHaveBeenCalledOnce();
            const cmd = mockSend.mock.calls[0][0];
            expect(cmd.input).toEqual({ SecretId: 'keyshelf/myapp/dev/db/password' });
            expect(value).toBe('s3cret');
        });

        it('throws descriptive error on ResourceNotFoundException', async () => {
            mockSend.mockRejectedValue({ name: 'ResourceNotFoundException' });

            await expect(provider.get('dev', 'db/password')).rejects.toThrow(
                /Secret "db\/password" not found in environment "dev"/
            );
        });

        it('re-throws non-NOT_FOUND errors', async () => {
            mockSend.mockRejectedValue(new Error('AccessDeniedException'));

            await expect(provider.get('dev', 'db/password')).rejects.toThrow(
                'AccessDeniedException'
            );
        });

        it('throws when SecretString is undefined (binary secret)', async () => {
            mockSend.mockResolvedValue({ SecretBinary: Buffer.from('data') });

            await expect(provider.get('dev', 'db/password')).rejects.toThrow(/binary/);
        });
    });

    describe('set', () => {
        it('value is retrievable after set to existing secret', async () => {
            const store = new Map<string, string>();

            mockSend.mockImplementation((cmd: { input: Record<string, unknown> }) => {
                if ('SecretString' in cmd.input && 'SecretId' in cmd.input) {
                    store.set(cmd.input.SecretId as string, cmd.input.SecretString as string);
                    return Promise.resolve({});
                }
                if ('SecretId' in cmd.input) {
                    const val = store.get(cmd.input.SecretId as string);
                    return Promise.resolve({ SecretString: val });
                }
                return Promise.resolve({});
            });

            await provider.set('dev', 'db/password', 'newvalue');
            const result = await provider.get('dev', 'db/password');

            expect(result).toBe('newvalue');
        });

        it('creates secret when it does not exist and value is retrievable', async () => {
            const store = new Map<string, string>();

            mockSend.mockImplementation((cmd: { input: Record<string, unknown> }) => {
                if ('Name' in cmd.input && 'SecretString' in cmd.input) {
                    store.set(cmd.input.Name as string, cmd.input.SecretString as string);
                    return Promise.resolve({});
                }
                if ('SecretId' in cmd.input && 'SecretString' in cmd.input) {
                    const id = cmd.input.SecretId as string;
                    if (!store.has(id)) {
                        return Promise.reject({ name: 'ResourceNotFoundException' });
                    }
                    store.set(id, cmd.input.SecretString as string);
                    return Promise.resolve({});
                }
                if ('SecretId' in cmd.input) {
                    const val = store.get(cmd.input.SecretId as string);
                    if (val === undefined) {
                        return Promise.reject({ name: 'ResourceNotFoundException' });
                    }
                    return Promise.resolve({ SecretString: val });
                }
                return Promise.resolve({});
            });

            await provider.set('dev', 'db/password', 'newvalue');
            const result = await provider.get('dev', 'db/password');

            expect(result).toBe('newvalue');
        });
    });

    describe('delete', () => {
        it('deletes secret with ForceDeleteWithoutRecovery', async () => {
            mockSend.mockResolvedValue({});

            await provider.delete('dev', 'db/password');

            expect(mockSend).toHaveBeenCalledOnce();
            const cmd = mockSend.mock.calls[0][0];
            expect(cmd.input).toEqual({
                SecretId: 'keyshelf/myapp/dev/db/password',
                ForceDeleteWithoutRecovery: true
            });
        });

        it('throws descriptive error on ResourceNotFoundException', async () => {
            mockSend.mockRejectedValue({ name: 'ResourceNotFoundException' });

            await expect(provider.delete('dev', 'db/password')).rejects.toThrow(
                /Secret "db\/password" not found in environment "dev"/
            );
        });

        it('re-throws non-NOT_FOUND errors', async () => {
            mockSend.mockRejectedValue(new Error('AccessDeniedException'));

            await expect(provider.delete('dev', 'db/password')).rejects.toThrow(
                'AccessDeniedException'
            );
        });
    });

    describe('list', () => {
        it('returns paths filtered by env prefix', async () => {
            mockSend.mockResolvedValue({
                SecretList: [
                    { Name: 'keyshelf/myapp/dev/db/password' },
                    { Name: 'keyshelf/myapp/dev/db/host' },
                    { Name: 'keyshelf/myapp/staging/db/password' }
                ],
                NextToken: undefined
            });

            const paths = await provider.list('dev');

            expect(paths).toEqual(['db/password', 'db/host']);
        });

        it('filters by path prefix', async () => {
            mockSend.mockResolvedValue({
                SecretList: [
                    { Name: 'keyshelf/myapp/dev/db/password' },
                    { Name: 'keyshelf/myapp/dev/db/host' },
                    { Name: 'keyshelf/myapp/dev/cache/url' }
                ],
                NextToken: undefined
            });

            const paths = await provider.list('dev', 'db');

            expect(paths).toEqual(['db/password', 'db/host']);
        });

        it('paginates through multiple pages', async () => {
            mockSend
                .mockResolvedValueOnce({
                    SecretList: [{ Name: 'keyshelf/myapp/dev/db/password' }],
                    NextToken: 'page2token'
                })
                .mockResolvedValueOnce({
                    SecretList: [{ Name: 'keyshelf/myapp/dev/db/host' }],
                    NextToken: undefined
                });

            const paths = await provider.list('dev');

            expect(mockSend).toHaveBeenCalledTimes(2);
            expect(paths).toEqual(['db/password', 'db/host']);
        });

        it('returns empty array when no secrets match', async () => {
            mockSend.mockResolvedValue({ SecretList: [], NextToken: undefined });

            const paths = await provider.list('dev');

            expect(paths).toEqual([]);
        });
    });

    describe('project isolation', () => {
        let providerA: AwsSmProvider;
        let providerB: AwsSmProvider;

        beforeEach(() => {
            providerA = new AwsSmProvider({ name: 'project-a' });
            providerB = new AwsSmProvider({ name: 'project-b' });
        });

        it('produces different keys for different project names', () => {
            expect(providerA.ref('dev', 'db/password')).toBe('keyshelf/project-a/dev/db/password');
            expect(providerB.ref('dev', 'db/password')).toBe('keyshelf/project-b/dev/db/password');
        });

        it('set and get are scoped: project-a value is not visible to project-b', async () => {
            const store = new Map<string, string>();

            mockSend.mockImplementation((cmd: { input: Record<string, unknown> }) => {
                if ('SecretString' in cmd.input && 'SecretId' in cmd.input) {
                    store.set(cmd.input.SecretId as string, cmd.input.SecretString as string);
                    return Promise.resolve({});
                }
                if ('SecretId' in cmd.input) {
                    const val = store.get(cmd.input.SecretId as string);
                    if (val === undefined) {
                        return Promise.reject({ name: 'ResourceNotFoundException' });
                    }
                    return Promise.resolve({ SecretString: val });
                }
                return Promise.resolve({});
            });

            await providerA.set('dev', 'db/password', 'secret-a');

            await expect(providerB.get('dev', 'db/password')).rejects.toThrow(
                /not found in environment/
            );
        });

        it('set and get round-trip is scoped per project', async () => {
            const store = new Map<string, string>();

            mockSend.mockImplementation((cmd: { input: Record<string, unknown> }) => {
                if ('SecretString' in cmd.input && 'SecretId' in cmd.input) {
                    store.set(cmd.input.SecretId as string, cmd.input.SecretString as string);
                    return Promise.resolve({});
                }
                if ('SecretId' in cmd.input) {
                    const val = store.get(cmd.input.SecretId as string);
                    if (val === undefined) {
                        return Promise.reject({ name: 'ResourceNotFoundException' });
                    }
                    return Promise.resolve({ SecretString: val });
                }
                return Promise.resolve({});
            });

            await providerA.set('dev', 'db/password', 'value-a');
            await providerB.set('dev', 'db/password', 'value-b');

            expect(await providerA.get('dev', 'db/password')).toBe('value-a');
            expect(await providerB.get('dev', 'db/password')).toBe('value-b');
        });

        it('list only returns secrets belonging to the queried project', async () => {
            mockSend.mockResolvedValue({
                SecretList: [
                    { Name: 'keyshelf/project-a/dev/db/password' },
                    { Name: 'keyshelf/project-b/dev/db/password' }
                ],
                NextToken: undefined
            });

            const paths = await providerA.list('dev');

            expect(paths).toEqual(['db/password']);
            expect(paths).not.toContain('keyshelf/project-b/dev/db/password');
        });
    });

    describe('constructor validation', () => {
        it('throws when project name contains a slash', () => {
            expect(() => new AwsSmProvider({ name: 'bad/name' })).toThrow(
                /project name must not contain "\/"/
            );
        });
    });
});

describe('buildSecretName', () => {
    it('returns keyshelf/<name>/<env>/<path>', () => {
        expect(buildSecretName('myapp', 'dev', 'db/password')).toBe(
            'keyshelf/myapp/dev/db/password'
        );
    });

    it('handles deeply nested paths', () => {
        expect(buildSecretName('myapp', 'prod', 'a/b/c/d')).toBe('keyshelf/myapp/prod/a/b/c/d');
    });

    it('throws when name contains a slash', () => {
        expect(() => buildSecretName('bad/name', 'dev', 'db/password')).toThrow(/name/);
    });

    it('throws when env contains a slash', () => {
        expect(() => buildSecretName('myapp', 'dev/bad', 'db/password')).toThrow(/env/);
    });
});
