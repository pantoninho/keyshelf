import { describe, it, expect, vi } from 'vitest';
import { replaceSecrets, flattenToEnvRecord, lookupPath } from '../../src/core/env-vars.js';
import { SecretRef } from '../../src/core/types.js';
import { SecretProvider } from '../../src/providers/provider.js';

function createMockProvider(secrets: Record<string, string>): SecretProvider {
    return {
        get: vi.fn(async (_env: string, path: string) => {
            const value = secrets[path];
            if (value === undefined) throw new Error(`Secret "${path}" not found`);
            return value;
        }),
        set: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
        ref: vi.fn((_env: string, path: string) => path)
    };
}

describe('replaceSecrets', () => {
    it('resolves SecretRef to actual values in reveal mode', async () => {
        const provider = createMockProvider({ 'db/password': 'hunter2' });
        const values = { db: { password: new SecretRef('db/password') } };

        const result = await replaceSecrets(values, 'prod', provider, 'reveal');

        expect(result).toEqual({ db: { password: 'hunter2' } });
        expect(provider.get).toHaveBeenCalledWith('prod', 'db/password');
    });

    it('resolves SecretRef to ref strings in ref mode', async () => {
        const provider = createMockProvider({});
        const values = { api: { key: new SecretRef('api/key') } };

        const result = await replaceSecrets(values, 'dev', provider, 'ref');

        expect(result).toEqual({ api: { key: 'api/key' } });
        expect(provider.ref).toHaveBeenCalledWith('dev', 'api/key');
    });

    it('passes through plain values unchanged', async () => {
        const provider = createMockProvider({});
        const values = { host: 'localhost', port: 5432, enabled: true };

        const result = await replaceSecrets(values, 'dev', provider, 'reveal');

        expect(result).toEqual({ host: 'localhost', port: 5432, enabled: true });
    });

    it('handles deeply nested objects', async () => {
        const provider = createMockProvider({ 'deep/secret': 'val' });
        const values = {
            a: { b: { c: { secret: new SecretRef('deep/secret'), plain: 'ok' } } }
        };

        const result = await replaceSecrets(values, 'prod', provider, 'reveal');

        expect(result).toEqual({ a: { b: { c: { secret: 'val', plain: 'ok' } } } });
    });
});

describe('lookupPath', () => {
    it('returns a top-level value', () => {
        expect(lookupPath({ host: 'localhost' }, 'host')).toBe('localhost');
    });

    it('returns a nested value via slash path', () => {
        expect(lookupPath({ db: { host: 'localhost' } }, 'db/host')).toBe('localhost');
    });

    it('returns undefined for missing path', () => {
        expect(lookupPath({ db: { host: 'localhost' } }, 'db/port')).toBeUndefined();
    });

    it('returns undefined when intermediate node is missing', () => {
        expect(lookupPath({}, 'a/b/c')).toBeUndefined();
    });
});

describe('flattenToEnvRecord', () => {
    it('returns only mapped variables', () => {
        const obj = { database: { host: 'localhost', port: 5432 }, api: { key: 'abc' } };
        const mapping = { DB_HOST: 'database/host', API_KEY: 'api/key' };

        const result = flattenToEnvRecord(obj, mapping);

        expect(result).toEqual({ DB_HOST: 'localhost', API_KEY: 'abc' });
    });

    it('converts mapped values to strings', () => {
        const obj = { db: { port: 5432 } };
        const mapping = { DB_PORT: 'db/port' };

        const result = flattenToEnvRecord(obj, mapping);

        expect(result).toEqual({ DB_PORT: '5432' });
    });

    it('uses exact var names from mapping without uppercasing', () => {
        const obj = { api: { url: 'https://example.com' } };
        const mapping = { my_custom_var: 'api/url' };

        const result = flattenToEnvRecord(obj, mapping);

        expect(result).toEqual({ my_custom_var: 'https://example.com' });
    });

    it('returns empty record when mapping is empty', () => {
        const obj = { database: { host: 'localhost', port: 5432 } };

        const result = flattenToEnvRecord(obj, {});

        expect(result).toEqual({});
    });

    it('throws when mapping references a non-existent path', () => {
        const obj = { api: {} };
        const mapping = { MISSING: 'api/key' };

        expect(() => flattenToEnvRecord(obj, mapping)).toThrow(
            /Env mapping "MISSING" references path "api\/key" which does not exist/
        );
    });
});
