import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import SecretGet from '../../../src/commands/secret/get.js';
import { saveEnvironment } from '../../../src/core/environment.js';
import { LocalProvider } from '../../../src/providers/local.js';
import { SecretRef } from '../../../src/core/types.js';

describe('secret:get command', () => {
    let tmpDir: string;
    let origCwd: string;
    let configDir: string;
    let logSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-secret-get-'));
        configDir = path.join(tmpDir, '.config');
        origCwd = process.cwd();
        process.chdir(tmpDir);
        fs.mkdirSync(path.join(tmpDir, '.keyshelf', 'environments'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ name: 'test-project', provider: { adapter: 'local' } })
        );
        logSpy = vi.fn();
        vi.spyOn(SecretGet.prototype, 'log').mockImplementation(logSpy);
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

        await SecretGet.run(['dev', 'database/password', '--config-dir', configDir]);
        expect(logSpy).toHaveBeenCalledWith('s3cret');
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

        await SecretGet.run(['dev', 'shared/key', '--config-dir', configDir]);
        expect(logSpy).toHaveBeenCalledWith('inherited-secret');
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

        await SecretGet.run(['dev', 'database/password', '--config-dir', envConfigDir]);
        expect(logSpy).toHaveBeenCalledWith('env-secret');
    });

    it('errors if secret path not found', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { host: 'localhost' } }
        });

        await expect(
            SecretGet.run(['dev', 'missing/secret', '--config-dir', configDir])
        ).rejects.toThrow(/missing\/secret/);
    });
});
