import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import ConfigRm from '../../../src/commands/config/rm.js';
import { loadEnvironment, saveEnvironment } from '../../../src/core/environment.js';

describe('config:rm command', () => {
    let tmpDir: string;
    let origCwd: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-config-rm-'));
        origCwd = process.cwd();
        process.chdir(tmpDir);
        fs.mkdirSync(path.join(tmpDir, '.keyshelf', 'environments'), { recursive: true });
    });

    afterEach(() => {
        process.chdir(origCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('removes a config value from environment YAML', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { host: 'localhost', port: 5432 } }
        });

        await ConfigRm.run(['dev', 'database/host']);

        const def = await loadEnvironment(tmpDir, 'dev');
        expect(def.values).toEqual({ database: { port: 5432 } });
    });

    it('cleans up empty parent nodes after removal', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { host: 'localhost' } }
        });

        await ConfigRm.run(['dev', 'database/host']);

        const def = await loadEnvironment(tmpDir, 'dev');
        expect(def.values).toEqual({});
    });

    it('errors if path not found', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { host: 'localhost' } }
        });

        await expect(ConfigRm.run(['dev', 'missing/key'])).rejects.toThrow(/missing\/key/);
    });

    it('does not affect imported values', async () => {
        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: { shared: 'from-base' }
        });
        await saveEnvironment(tmpDir, 'dev', {
            imports: ['base'],
            values: { local: 'from-dev' }
        });

        await expect(ConfigRm.run(['dev', 'shared'])).rejects.toThrow();

        const def = await loadEnvironment(tmpDir, 'dev');
        expect(def.values).toEqual({ local: 'from-dev' });
    });
});
