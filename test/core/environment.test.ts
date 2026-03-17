import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadEnvironment, saveEnvironment, listEnvironments } from '../../src/core/environment.js';
import { SecretRef } from '../../src/core/types.js';

describe('environment I/O', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('save then load an environment round-trips correctly', async () => {
        const def = {
            imports: [],
            values: { database: { host: 'localhost', port: 5432 } }
        };

        await saveEnvironment(tmpDir, 'dev', def);
        const loaded = await loadEnvironment(tmpDir, 'dev');

        expect(loaded).toEqual(def);
    });

    it('save then load preserves SecretRef values', async () => {
        const def = {
            imports: [],
            values: { database: { password: new SecretRef('db/password') } }
        };

        await saveEnvironment(tmpDir, 'dev', def);
        const loaded = await loadEnvironment(tmpDir, 'dev');

        expect(loaded.values.database).toEqual({ password: expect.any(SecretRef) });
        const pw = (loaded.values.database as Record<string, unknown>).password as SecretRef;
        expect(pw.path).toBe('db/password');
    });

    it('load environment with imports', async () => {
        const def = {
            imports: ['base', 'shared'],
            values: { key: 'val' }
        };

        await saveEnvironment(tmpDir, 'staging', def);
        const loaded = await loadEnvironment(tmpDir, 'staging');

        expect(loaded.imports).toEqual(['base', 'shared']);
        expect(loaded.values).toEqual({ key: 'val' });
    });

    it('load environment that does not exist throws descriptive error', async () => {
        await expect(loadEnvironment(tmpDir, 'nonexistent')).rejects.toThrow(/nonexistent/);
    });

    it('list environments returns names from .keyshelf/environments/', async () => {
        await saveEnvironment(tmpDir, 'dev', { imports: [], values: {} });
        await saveEnvironment(tmpDir, 'staging', { imports: [], values: {} });
        await saveEnvironment(tmpDir, 'prod', { imports: [], values: {} });

        const envs = await listEnvironments(tmpDir);
        expect(envs.sort()).toEqual(['dev', 'prod', 'staging']);
    });

    it('list environments returns empty array when no environments exist', async () => {
        const envs = await listEnvironments(tmpDir);
        expect(envs).toEqual([]);
    });

    it('save creates .keyshelf/environments/ directory if missing', async () => {
        const envDir = path.join(tmpDir, '.keyshelf', 'environments');
        expect(fs.existsSync(envDir)).toBe(false);

        await saveEnvironment(tmpDir, 'dev', { imports: [], values: { key: 'val' } });

        expect(fs.existsSync(envDir)).toBe(true);
    });

    it('saveEnvironment overwrites an existing file with new content', async () => {
        await saveEnvironment(tmpDir, 'dev', { imports: [], values: { key: 'original' } });
        await saveEnvironment(tmpDir, 'dev', { imports: [], values: { key: 'updated' } });

        const loaded = await loadEnvironment(tmpDir, 'dev');
        expect(loaded.values).toEqual({ key: 'updated' });
    });
});
