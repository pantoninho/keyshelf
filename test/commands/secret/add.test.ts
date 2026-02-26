import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import SecretAdd from '../../../src/commands/secret/add.js';
import { loadEnvironment, saveEnvironment } from '../../../src/core/environment.js';
import { LocalProvider } from '../../../src/providers/local.js';
import { SecretRef } from '../../../src/core/types.js';

describe('secret:add command', () => {
    let tmpDir: string;
    let origCwd: string;
    let configDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-secret-add-'));
        configDir = path.join(tmpDir, '.config');
        origCwd = process.cwd();
        process.chdir(tmpDir);
        fs.mkdirSync(path.join(tmpDir, '.keyshelf', 'environments'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ name: 'test-project', provider: { adapter: 'local' } })
        );
    });

    afterEach(() => {
        process.chdir(origCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('stores value in secret provider', async () => {
        await saveEnvironment(tmpDir, 'dev', { imports: [], values: {} });

        await SecretAdd.run(['dev', 'database/password', 's3cret', '--config-dir', configDir]);

        const provider = new LocalProvider(configDir);
        expect(await provider.get('dev', 'database/password')).toBe('s3cret');
    });

    it('adds !secret ref to environment YAML', async () => {
        await saveEnvironment(tmpDir, 'dev', { imports: [], values: {} });

        await SecretAdd.run(['dev', 'database/password', 's3cret', '--config-dir', configDir]);

        const def = await loadEnvironment(tmpDir, 'dev');
        const pw = (def.values.database as Record<string, unknown>).password;
        expect(pw).toBeInstanceOf(SecretRef);
        expect((pw as SecretRef).path).toBe('database/password');
    });

    it('overwrites existing secret in provider', async () => {
        await saveEnvironment(tmpDir, 'dev', { imports: [], values: {} });

        await SecretAdd.run(['dev', 'key', 'old', '--config-dir', configDir]);
        await SecretAdd.run(['dev', 'key', 'new', '--config-dir', configDir]);

        const provider = new LocalProvider(configDir);
        expect(await provider.get('dev', 'key')).toBe('new');
    });

    it('updates existing !secret ref if path already exists', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { key: new SecretRef('key') }
        });

        await SecretAdd.run(['dev', 'key', 'updated', '--config-dir', configDir]);

        const def = await loadEnvironment(tmpDir, 'dev');
        expect(def.values.key).toBeInstanceOf(SecretRef);
    });

    it('errors if environment does not exist', async () => {
        await expect(
            SecretAdd.run(['nope', 'key', 'val', '--config-dir', configDir])
        ).rejects.toThrow(/nope/);
    });
});
