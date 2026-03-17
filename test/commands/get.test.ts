import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import Get from '../../src/commands/get.js';
import { saveEnvironment } from '../../src/core/environment.js';
import { LocalProvider } from '../../src/providers/local.js';
import { SecretRef } from '../../src/core/types.js';

describe('get command', () => {
    let tmpDir: string;
    let origCwd: string;
    let configDir: string;
    let logSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-get-'));
        configDir = path.join(tmpDir, '.config');
        origCwd = process.cwd();
        process.chdir(tmpDir);
        fs.mkdirSync(path.join(tmpDir, '.keyshelf', 'environments'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ name: 'test-project', provider: { adapter: 'local' } })
        );
        logSpy = vi.fn();
        vi.spyOn(Get.prototype, 'log').mockImplementation(logSpy);
    });

    afterEach(() => {
        process.chdir(origCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('fetches secret value from provider', async () => {
        const provider = new LocalProvider(configDir);
        await provider.set('dev', 'database/password', 's3cret');
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { password: new SecretRef('database/password') } }
        });

        await Get.run(['--env', 'dev', 'database/password', '--config-dir', configDir]);
        expect(logSpy).toHaveBeenCalledWith('s3cret');
    });

    it('gets a plain config value', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { host: 'localhost' } }
        });

        await Get.run(['--env', 'dev', 'database/host', '--config-dir', configDir]);
        expect(logSpy).toHaveBeenCalledWith('localhost');
    });

    it('gets a value inherited from an imported environment', async () => {
        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: { database: { port: 5432 } }
        });
        await saveEnvironment(tmpDir, 'dev', {
            imports: ['base'],
            values: { database: { host: 'localhost' } }
        });

        await Get.run(['--env', 'dev', 'database/port', '--config-dir', configDir]);
        expect(logSpy).toHaveBeenCalledWith('5432');
    });

    it('local value overrides imported value', async () => {
        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: { database: { host: 'prod-db' } }
        });
        await saveEnvironment(tmpDir, 'dev', {
            imports: ['base'],
            values: { database: { host: 'localhost' } }
        });

        await Get.run(['--env', 'dev', 'database/host', '--config-dir', configDir]);
        expect(logSpy).toHaveBeenCalledWith('localhost');
    });

    it('uses env-level provider over global config', async () => {
        const envConfigDir = path.join(tmpDir, '.env-config');
        const provider = new LocalProvider(envConfigDir);
        await provider.set('dev', 'database/password', 'env-secret');
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { password: new SecretRef('database/password') } },
            provider: { adapter: 'local' }
        });

        await Get.run(['--env', 'dev', 'database/password', '--config-dir', envConfigDir]);
        expect(logSpy).toHaveBeenCalledWith('env-secret');
    });

    it('resolves secret through imported environment', async () => {
        const provider = new LocalProvider(configDir);
        await provider.set('dev', 'shared/key', 'inherited-secret');
        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: { shared: { key: new SecretRef('shared/key') } }
        });
        await saveEnvironment(tmpDir, 'dev', {
            imports: ['base'],
            values: {}
        });

        await Get.run(['--env', 'dev', 'shared/key', '--config-dir', configDir]);
        expect(logSpy).toHaveBeenCalledWith('inherited-secret');
    });

    it('errors if path not found with hint to run keyshelf list', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { host: 'localhost' } }
        });

        await expect(
            Get.run(['--env', 'dev', 'missing/path', '--config-dir', configDir])
        ).rejects.toThrow(/missing\/path/);
    });

    it('errors if path points to a subtree', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { host: 'localhost', port: 5432 } }
        });

        await expect(
            Get.run(['--env', 'dev', 'database', '--config-dir', configDir])
        ).rejects.toThrow(/not a leaf value/);
    });
});
