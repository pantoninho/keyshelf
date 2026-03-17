import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import SetCommand from '../../src/commands/set.js';
import { saveEnvironment, loadEnvironment } from '../../src/core/environment.js';
import { LocalProvider } from '../../src/providers/local.js';
import { SecretRef } from '../../src/core/types.js';
import * as inputModule from '../../src/core/input.js';

describe('set command', () => {
    let tmpDir: string;
    let origCwd: string;
    let configDir: string;
    let logSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-set-'));
        configDir = path.join(tmpDir, '.config');
        origCwd = process.cwd();
        process.chdir(tmpDir);
        fs.mkdirSync(path.join(tmpDir, '.keyshelf', 'environments'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ name: 'test-project', provider: { adapter: 'local' } })
        );
        logSpy = vi.fn();
        vi.spyOn(SetCommand.prototype, 'log').mockImplementation(logSpy);
    });

    afterEach(() => {
        process.chdir(origCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('sets a secret value for an existing SecretRef', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { password: new SecretRef('database/password') } }
        });

        await SetCommand.run([
            '--env',
            'dev',
            'database/password',
            'mysecret',
            '--config-dir',
            configDir
        ]);

        const provider = new LocalProvider(configDir);
        const stored = await provider.get('dev', 'database/password');
        expect(stored).toBe('mysecret');
    });

    it('creates SecretRef in YAML and sets value when path does not exist', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: {}
        });

        await SetCommand.run([
            '--env',
            'dev',
            'database/password',
            'newpassword',
            '--config-dir',
            configDir
        ]);

        const envDef = await loadEnvironment(tmpDir, 'dev');
        const { database } = envDef.values as { database: { password: unknown } };
        expect(database.password).toBeInstanceOf(SecretRef);

        const provider = new LocalProvider(configDir);
        expect(await provider.get('dev', 'database/password')).toBe('newpassword');
    });

    it('errors when path is a plain value, not a secret', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { password: 'plain-text' } }
        });

        await expect(
            SetCommand.run([
                '--env',
                'dev',
                'database/password',
                'newvalue',
                '--config-dir',
                configDir
            ])
        ).rejects.toThrow(/plain value, not a secret reference/);
    });

    it('propagates to child environments that import the target env', async () => {
        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: { shared: { key: new SecretRef('shared/key') } }
        });
        await saveEnvironment(tmpDir, 'dev', {
            imports: ['base'],
            values: {}
        });

        await SetCommand.run([
            '--env',
            'base',
            'shared/key',
            'propagated-value',
            '--config-dir',
            configDir
        ]);

        const provider = new LocalProvider(configDir);
        const baseValue = await provider.get('base', 'shared/key');
        expect(baseValue).toBe('propagated-value');

        const devValue = await provider.get('dev', 'shared/key');
        expect(devValue).toBe('propagated-value');

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('dev'));
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('shared/key'));
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('base'));
    });

    it('prompts interactively when value arg is omitted', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { api: { key: new SecretRef('api/key') } }
        });

        vi.spyOn(inputModule, 'readMaskedLine').mockResolvedValue('prompted-secret');

        await SetCommand.run(['--env', 'dev', 'api/key', '--config-dir', configDir]);

        const provider = new LocalProvider(configDir);
        const stored = await provider.get('dev', 'api/key');
        expect(stored).toBe('prompted-secret');
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

        await SetCommand.run([
            '--env',
            'base',
            'shared/key',
            'propagated-value',
            '--config-dir',
            configDir
        ]);

        const provider = new LocalProvider(configDir);
        expect(await provider.get('base', 'shared/key')).toBe('propagated-value');
        expect(await provider.get('dev', 'shared/key')).toBe('propagated-value');
        await expect(provider.get('staging', 'shared/key')).rejects.toThrow();
    });

    it('propagation uses the importer own provider when it has an env-level provider override', async () => {
        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: { db: { pass: new SecretRef('db/pass') } }
        });
        await saveEnvironment(tmpDir, 'prod', {
            imports: ['base'],
            values: {},
            provider: { adapter: 'local' }
        });

        await SetCommand.run(['--env', 'base', 'db/pass', 'secret123', '--config-dir', configDir]);

        const provider = new LocalProvider(configDir);
        expect(await provider.get('base', 'db/pass')).toBe('secret123');
        expect(await provider.get('prod', 'db/pass')).toBe('secret123');
    });

    it('errors with helpful message if environment does not exist', async () => {
        await expect(
            SetCommand.run([
                '--env',
                'nonexistent',
                'some/path',
                'value',
                '--config-dir',
                configDir
            ])
        ).rejects.toThrow(/nonexistent/);
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

        await SetCommand.run([
            '--env',
            'base',
            'shared/key',
            'deep-propagated',
            '--config-dir',
            configDir
        ]);

        const provider = new LocalProvider(configDir);
        expect(await provider.get('base', 'shared/key')).toBe('deep-propagated');
        expect(await provider.get('staging', 'shared/key')).toBe('deep-propagated');
        expect(await provider.get('prod', 'shared/key')).toBe('deep-propagated');
    });

    it('propagates through diamond dependency without duplicating writes', async () => {
        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: { shared: { token: new SecretRef('shared/token') } }
        });
        await saveEnvironment(tmpDir, 'shared', {
            imports: ['base'],
            values: {}
        });
        await saveEnvironment(tmpDir, 'staging', {
            imports: ['base'],
            values: {}
        });
        await saveEnvironment(tmpDir, 'prod', {
            imports: ['shared', 'staging'],
            values: {}
        });

        const setSpy = vi.spyOn(LocalProvider.prototype, 'set');

        await SetCommand.run([
            '--env',
            'base',
            'shared/token',
            'diamond-value',
            '--config-dir',
            configDir
        ]);

        const provider = new LocalProvider(configDir);
        expect(await provider.get('base', 'shared/token')).toBe('diamond-value');
        expect(await provider.get('shared', 'shared/token')).toBe('diamond-value');
        expect(await provider.get('staging', 'shared/token')).toBe('diamond-value');
        expect(await provider.get('prod', 'shared/token')).toBe('diamond-value');

        const prodWrites = setSpy.mock.calls.filter(
            ([env, secretPath]) => env === 'prod' && secretPath === 'shared/token'
        );
        expect(prodWrites).toHaveLength(1);
    });

    it('stops propagation mid-chain when provider.set throws', async () => {
        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: { db: { pass: new SecretRef('db/pass') } }
        });
        await saveEnvironment(tmpDir, 'staging', {
            imports: ['base'],
            values: {}
        });
        await saveEnvironment(tmpDir, 'prod', {
            imports: ['staging'],
            values: {}
        });

        const realSet = LocalProvider.prototype.set.bind(new LocalProvider(configDir));
        vi.spyOn(LocalProvider.prototype, 'set').mockImplementation(
            async (env, secretPath, value) => {
                if (env === 'staging') {
                    throw new Error('Provider unavailable for staging');
                }
                return realSet(env, secretPath, value);
            }
        );

        await expect(
            SetCommand.run(['--env', 'base', 'db/pass', 'secret', '--config-dir', configDir])
        ).rejects.toThrow(/Provider unavailable for staging/);
    });
});
