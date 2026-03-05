import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import SecretRm from '../../../src/commands/secret/rm.js';
import { loadEnvironment, saveEnvironment } from '../../../src/core/environment.js';
import { LocalProvider } from '../../../src/providers/local.js';
import { SecretRef } from '../../../src/core/types.js';

describe('secret:rm command', () => {
    let tmpDir: string;
    let origCwd: string;
    let configDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-secret-rm-'));
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

    it('deletes secret from provider', async () => {
        const provider = new LocalProvider(configDir);
        await provider.set('dev', 'database/password', 's3cret');
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { password: new SecretRef('database/password') } }
        });

        await SecretRm.run(['dev', 'database/password', '--config-dir', configDir]);

        await expect(provider.get('dev', 'database/password')).rejects.toThrow();
    });

    it('removes !secret ref from environment YAML', async () => {
        const provider = new LocalProvider(configDir);
        await provider.set('dev', 'database/password', 's3cret');
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: {
                database: {
                    host: 'localhost',
                    password: new SecretRef('database/password')
                }
            }
        });

        await SecretRm.run(['dev', 'database/password', '--config-dir', configDir]);

        const def = await loadEnvironment(tmpDir, 'dev');
        expect(def.values).toEqual({ database: { host: 'localhost' } });
    });

    it('preserves env-level provider after removing a secret', async () => {
        const provider = new LocalProvider(configDir);
        await provider.set('dev', 'database/password', 's3cret');
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { password: new SecretRef('database/password') } },
            provider: { adapter: 'local' }
        });

        await SecretRm.run(['dev', 'database/password', '--config-dir', configDir]);

        const def = await loadEnvironment(tmpDir, 'dev');
        expect(def.provider).toEqual({ adapter: 'local' });
    });

    it('errors if secret not found', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { host: 'localhost' } }
        });

        await expect(
            SecretRm.run(['dev', 'missing/secret', '--config-dir', configDir])
        ).rejects.toThrow(/missing\/secret/);
    });
});
