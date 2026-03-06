import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import ConfigAdd from '../../../src/commands/config/add.js';
import { loadEnvironment } from '../../../src/core/environment.js';
import { saveEnvironment } from '../../../src/core/environment.js';

describe('config:add command', () => {
    let tmpDir: string;
    let origCwd: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-config-add-'));
        origCwd = process.cwd();
        process.chdir(tmpDir);
        fs.mkdirSync(path.join(tmpDir, '.keyshelf', 'environments'), { recursive: true });
    });

    afterEach(() => {
        process.chdir(origCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('adds a config value to environment YAML at correct path', async () => {
        await saveEnvironment(tmpDir, 'dev', { imports: [], values: {} });
        await ConfigAdd.run(['dev', 'database/host', 'localhost']);

        const def = await loadEnvironment(tmpDir, 'dev');
        expect(def.values).toEqual({ database: { host: 'localhost' } });
    });

    it('creates nested structure for deep paths', async () => {
        await saveEnvironment(tmpDir, 'dev', { imports: [], values: {} });
        await ConfigAdd.run(['dev', 'a/b/c', 'deep']);

        const def = await loadEnvironment(tmpDir, 'dev');
        expect(def.values).toEqual({ a: { b: { c: 'deep' } } });
    });

    it('adds to existing values without overwriting siblings', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { host: 'localhost' } }
        });
        await ConfigAdd.run(['dev', 'database/port', '5432']);

        const def = await loadEnvironment(tmpDir, 'dev');
        expect(def.values).toEqual({ database: { host: 'localhost', port: '5432' } });
    });

    it('preserves env-level provider after adding a config value', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: {},
            provider: { adapter: 'gcp-sm', project: 'my-gcp-project' }
        });

        await ConfigAdd.run(['dev', 'database/host', 'localhost']);

        const def = await loadEnvironment(tmpDir, 'dev');
        expect(def.provider).toEqual({ adapter: 'gcp-sm', project: 'my-gcp-project' });
    });

    it('errors if environment does not exist', async () => {
        await expect(ConfigAdd.run(['nope', 'key', 'val'])).rejects.toThrow(/nope/);
    });
});
