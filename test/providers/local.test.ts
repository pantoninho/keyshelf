import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LocalProvider } from '../../src/providers/local.js';

describe('LocalProvider', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-local-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('set and get a secret', async () => {
        const provider = new LocalProvider(tmpDir);
        await provider.set('dev', 'database/password', 's3cret');

        const value = await provider.get('dev', 'database/password');
        expect(value).toBe('s3cret');
    });

    it('get missing secret throws', async () => {
        const provider = new LocalProvider(tmpDir);
        await expect(provider.get('dev', 'missing/path')).rejects.toThrow(/missing\/path/);
    });

    it('delete a secret', async () => {
        const provider = new LocalProvider(tmpDir);
        await provider.set('dev', 'database/password', 's3cret');
        await provider.delete('dev', 'database/password');

        await expect(provider.get('dev', 'database/password')).rejects.toThrow();
    });

    it('delete missing secret throws', async () => {
        const provider = new LocalProvider(tmpDir);
        await expect(provider.delete('dev', 'nope')).rejects.toThrow(/nope/);
    });

    it('list secrets for an environment', async () => {
        const provider = new LocalProvider(tmpDir);
        await provider.set('dev', 'database/password', 'pw');
        await provider.set('dev', 'api/key', 'ak');

        const paths = await provider.list('dev');
        expect(paths.sort()).toEqual(['api/key', 'database/password']);
    });

    it('list secrets with prefix filter', async () => {
        const provider = new LocalProvider(tmpDir);
        await provider.set('dev', 'database/password', 'pw');
        await provider.set('dev', 'database/host', 'h');
        await provider.set('dev', 'api/key', 'ak');

        const paths = await provider.list('dev', 'database');
        expect(paths.sort()).toEqual(['database/host', 'database/password']);
    });

    it('list returns empty array when no secrets exist', async () => {
        const provider = new LocalProvider(tmpDir);
        const paths = await provider.list('dev');
        expect(paths).toEqual([]);
    });

    it('secrets are scoped by environment', async () => {
        const provider = new LocalProvider(tmpDir);
        await provider.set('dev', 'key', 'dev-val');
        await provider.set('prod', 'key', 'prod-val');

        expect(await provider.get('dev', 'key')).toBe('dev-val');
        expect(await provider.get('prod', 'key')).toBe('prod-val');
    });

    it('set overwrites existing secret', async () => {
        const provider = new LocalProvider(tmpDir);
        await provider.set('dev', 'key', 'old');
        await provider.set('dev', 'key', 'new');

        expect(await provider.get('dev', 'key')).toBe('new');
    });

    describe('ref', () => {
        it('returns the keyshelf path', () => {
            const provider = new LocalProvider(tmpDir);
            expect(provider.ref('dev', 'database/password')).toBe('database/password');
        });

        it('ignores environment', () => {
            const provider = new LocalProvider(tmpDir);
            expect(provider.ref('prod', 'api/key')).toBe('api/key');
        });
    });

    it('data persists across provider instances', async () => {
        const provider1 = new LocalProvider(tmpDir);
        await provider1.set('dev', 'key', 'persisted');

        const provider2 = new LocalProvider(tmpDir);
        expect(await provider2.get('dev', 'key')).toBe('persisted');
    });
});
