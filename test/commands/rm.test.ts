import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import RmCommand from '../../src/commands/rm.js';
import { saveEnvironment, loadEnvironment } from '../../src/core/environment.js';
import { LocalProvider } from '../../src/providers/local.js';
import { SecretRef } from '../../src/core/types.js';

describe('rm command', () => {
    let tmpDir: string;
    let origCwd: string;
    let configDir: string;
    let logSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-rm-'));
        configDir = path.join(tmpDir, '.config');
        origCwd = process.cwd();
        process.chdir(tmpDir);
        fs.mkdirSync(path.join(tmpDir, '.keyshelf', 'environments'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ name: 'test-project', provider: { adapter: 'local' } })
        );
        logSpy = vi.fn();
        vi.spyOn(RmCommand.prototype, 'log').mockImplementation(logSpy);
    });

    afterEach(() => {
        process.chdir(origCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('removes a plain config value from YAML', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { app: { port: 3000 } }
        });

        await RmCommand.run(['--env', 'dev', 'app/port', '--config-dir', configDir]);

        const envDef = await loadEnvironment(tmpDir, 'dev');
        expect(envDef.values).toEqual({});
    });

    it('removes a secret: deletes from YAML and provider', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { password: new SecretRef('database/password') } }
        });

        const provider = new LocalProvider(configDir);
        await provider.set('dev', 'database/password', 'secret-value');

        await RmCommand.run(['--env', 'dev', 'database/password', '--config-dir', configDir]);

        const envDef = await loadEnvironment(tmpDir, 'dev');
        expect(envDef.values).toEqual({});
        await expect(provider.get('dev', 'database/password')).rejects.toThrow();
    });

    it('propagates deletion to child environments', async () => {
        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: { shared: { key: new SecretRef('shared/key') } }
        });
        await saveEnvironment(tmpDir, 'dev', {
            imports: ['base'],
            values: {}
        });

        const provider = new LocalProvider(configDir);
        await provider.set('base', 'shared/key', 'base-value');
        await provider.set('dev', 'shared/key', 'dev-value');

        await RmCommand.run(['--env', 'base', 'shared/key', '--config-dir', configDir]);

        await expect(provider.get('base', 'shared/key')).rejects.toThrow();
        await expect(provider.get('dev', 'shared/key')).rejects.toThrow();
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('dev'));
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('shared/key'));
    });

    it('errors when path does not exist', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: {}
        });

        await expect(
            RmCommand.run(['--env', 'dev', 'nonexistent/path', '--config-dir', configDir])
        ).rejects.toThrow(/does not exist/);
    });

    it('errors when path is inherited, not defined directly', async () => {
        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: { shared: { key: new SecretRef('shared/key') } }
        });
        await saveEnvironment(tmpDir, 'dev', {
            imports: ['base'],
            values: {}
        });

        await expect(
            RmCommand.run(['--env', 'dev', 'shared/key', '--config-dir', configDir])
        ).rejects.toThrow(/inherited/);
    });

    it('cleans up empty parent objects in YAML after deletion', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: {
                database: { password: 'secret' },
                app: { nested: { deep: 'value' } }
            }
        });

        await RmCommand.run(['--env', 'dev', 'app/nested/deep', '--config-dir', configDir]);

        const envDef = await loadEnvironment(tmpDir, 'dev');
        expect(envDef.values).toEqual({ database: { password: 'secret' } });
    });

    it('propagates through a 3-level chain (base → staging → prod)', async () => {
        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: { shared: { key: new SecretRef('shared/key') } }
        });
        await saveEnvironment(tmpDir, 'staging', {
            imports: ['base'],
            values: {}
        });
        await saveEnvironment(tmpDir, 'prod', {
            imports: ['staging'],
            values: {}
        });

        const provider = new LocalProvider(configDir);
        await provider.set('base', 'shared/key', 'val');
        await provider.set('staging', 'shared/key', 'val');
        await provider.set('prod', 'shared/key', 'val');

        await RmCommand.run(['--env', 'base', 'shared/key', '--config-dir', configDir]);

        await expect(provider.get('base', 'shared/key')).rejects.toThrow();
        await expect(provider.get('staging', 'shared/key')).rejects.toThrow();
        await expect(provider.get('prod', 'shared/key')).rejects.toThrow();
    });

    it('propagation skips environments where the path is not a SecretRef', async () => {
        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: { shared: { key: new SecretRef('shared/key') } }
        });
        await saveEnvironment(tmpDir, 'staging', {
            imports: ['base'],
            values: { shared: { key: 'overridden-plain-value' } }
        });
        await saveEnvironment(tmpDir, 'dev', {
            imports: ['base'],
            values: {}
        });

        const provider = new LocalProvider(configDir);
        await provider.set('base', 'shared/key', 'val');
        await provider.set('dev', 'shared/key', 'val');

        const deleteSpy = vi.spyOn(LocalProvider.prototype, 'delete');

        await RmCommand.run(['--env', 'base', 'shared/key', '--config-dir', configDir]);

        const stagingDeletes = deleteSpy.mock.calls.filter(([env]) => env === 'staging');
        expect(stagingDeletes).toHaveLength(0);
        await expect(provider.get('dev', 'shared/key')).rejects.toThrow();
    });
});
