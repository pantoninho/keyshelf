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

vi.mock('@aws-sdk/credential-providers', () => ({
    fromIni: vi.fn(() => 'mocked-credentials')
}));

describe('AwsSmProvider', () => {
    let provider: AwsSmProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new AwsSmProvider({});
    });

    describe('get', () => {
        it('returns SecretString from AWS response', async () => {
            mockSend.mockResolvedValue({ SecretString: 's3cret' });

            const value = await provider.get('dev', 'db/password');

            expect(mockSend).toHaveBeenCalledOnce();
            const cmd = mockSend.mock.calls[0][0];
            expect(cmd.input).toEqual({ SecretId: 'keyshelf/dev/db/password' });
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
        it('puts value to existing secret', async () => {
            mockSend.mockResolvedValueOnce({});

            await provider.set('dev', 'db/password', 'newvalue');

            expect(mockSend).toHaveBeenCalledOnce();
            const cmd = mockSend.mock.calls[0][0];
            expect(cmd.input).toEqual({
                SecretId: 'keyshelf/dev/db/password',
                SecretString: 'newvalue'
            });
        });

        it('creates secret when it does not exist', async () => {
            mockSend.mockRejectedValueOnce({ name: 'ResourceNotFoundException' });
            mockSend.mockResolvedValueOnce({});

            await provider.set('dev', 'db/password', 'newvalue');

            expect(mockSend).toHaveBeenCalledTimes(2);
            const createCmd = mockSend.mock.calls[1][0];
            expect(createCmd.input).toEqual({
                Name: 'keyshelf/dev/db/password',
                SecretString: 'newvalue'
            });
        });
    });

    describe('delete', () => {
        it('deletes secret with ForceDeleteWithoutRecovery', async () => {
            mockSend.mockResolvedValue({});

            await provider.delete('dev', 'db/password');

            expect(mockSend).toHaveBeenCalledOnce();
            const cmd = mockSend.mock.calls[0][0];
            expect(cmd.input).toEqual({
                SecretId: 'keyshelf/dev/db/password',
                ForceDeleteWithoutRecovery: true
            });
        });

        it('throws descriptive error on ResourceNotFoundException', async () => {
            mockSend.mockRejectedValue({ name: 'ResourceNotFoundException' });

            await expect(provider.delete('dev', 'db/password')).rejects.toThrow(
                /Secret "db\/password" not found in environment "dev"/
            );
        });
    });

    describe('list', () => {
        it('returns paths filtered by env prefix', async () => {
            mockSend.mockResolvedValue({
                SecretList: [
                    { Name: 'keyshelf/dev/db/password' },
                    { Name: 'keyshelf/dev/db/host' },
                    { Name: 'keyshelf/staging/db/password' }
                ],
                NextToken: undefined
            });

            const paths = await provider.list('dev');

            expect(paths).toEqual(['db/password', 'db/host']);
        });

        it('filters by path prefix', async () => {
            mockSend.mockResolvedValue({
                SecretList: [
                    { Name: 'keyshelf/dev/db/password' },
                    { Name: 'keyshelf/dev/db/host' },
                    { Name: 'keyshelf/dev/cache/url' }
                ],
                NextToken: undefined
            });

            const paths = await provider.list('dev', 'db');

            expect(paths).toEqual(['db/password', 'db/host']);
        });

        it('paginates through multiple pages', async () => {
            mockSend
                .mockResolvedValueOnce({
                    SecretList: [{ Name: 'keyshelf/dev/db/password' }],
                    NextToken: 'page2token'
                })
                .mockResolvedValueOnce({
                    SecretList: [{ Name: 'keyshelf/dev/db/host' }],
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

    describe('ref', () => {
        it('returns keyshelf/<env>/<path>', () => {
            expect(provider.ref('prod', 'database/password')).toBe(
                'keyshelf/prod/database/password'
            );
        });

        it('handles deeply nested paths', () => {
            expect(provider.ref('dev', 'a/b/c/d')).toBe('keyshelf/dev/a/b/c/d');
        });
    });
});

describe('buildSecretName', () => {
    it('returns keyshelf/<env>/<path>', () => {
        expect(buildSecretName('dev', 'db/password')).toBe('keyshelf/dev/db/password');
    });

    it('handles deeply nested paths', () => {
        expect(buildSecretName('prod', 'a/b/c/d')).toBe('keyshelf/prod/a/b/c/d');
    });

    it('throws when env contains a slash', () => {
        expect(() => buildSecretName('dev/bad', 'db/password')).toThrow(/env/);
    });
});
