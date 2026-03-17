import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import SetCommand from '../../src/commands/set.js';
import RmCommand from '../../src/commands/rm.js';
import { saveEnvironment, loadEnvironment } from '../../src/core/environment.js';
import { SecretRef } from '../../src/core/types.js';
import { SecretProvider } from '../../src/providers/provider.js';
import { providerConfig, providerLabel, createTestProvider } from './provider-fixture.js';

describe(`rm command (e2e against ${providerLabel})`, () => {
    let tmpDir: string;
    let origCwd: string;
    let configDir: string;
    let provider: SecretProvider;
    let secretsToCleanup: Array<{ env: string; path: string }>;

    beforeEach(() => {
        const projectName = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-e2e-rm-'));
        configDir = path.join(tmpDir, '.config');
        origCwd = process.cwd();
        process.chdir(tmpDir);
        fs.mkdirSync(path.join(tmpDir, '.keyshelf', 'environments'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ name: projectName, provider: providerConfig })
        );
        provider = createTestProvider(projectName, configDir);
        secretsToCleanup = [];
    });

    afterEach(async () => {
        process.chdir(origCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });

        for (const { env, path: secretPath } of secretsToCleanup) {
            try {
                await provider.delete(env, secretPath);
            } catch {
                // Ignore — secret may already be deleted
            }
        }
    });

    it('removes a secret from the provider', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { api: { key: new SecretRef('api/key') } }
        });

        await SetCommand.run([
            '--env',
            'dev',
            '--config-dir',
            configDir,
            'api/key',
            'e2e-api-key-value'
        ]);

        await RmCommand.run(['--env', 'dev', '--config-dir', configDir, 'api/key']);

        await expect(provider.get('dev', 'api/key')).rejects.toThrow();

        const envDef = await loadEnvironment(tmpDir, 'dev');
        expect(envDef.values).toEqual({});
    });

    it('propagates removal to child environment providers', async () => {
        secretsToCleanup.push(
            { env: 'base', path: 'shared/token' },
            { env: 'staging', path: 'shared/token' }
        );
        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: { shared: { token: new SecretRef('shared/token') } }
        });
        await saveEnvironment(tmpDir, 'staging', {
            imports: ['base'],
            values: {}
        });

        await SetCommand.run([
            '--env',
            'base',
            '--config-dir',
            configDir,
            'shared/token',
            'propagated-e2e-value'
        ]);

        await RmCommand.run(['--env', 'base', '--config-dir', configDir, 'shared/token']);

        await expect(provider.get('base', 'shared/token')).rejects.toThrow();
        await expect(provider.get('staging', 'shared/token')).rejects.toThrow();
    });

    it('verifies YAML is updated after removal', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: {
                api: { key: new SecretRef('api/key') },
                app: { name: 'my-app' }
            }
        });

        await SetCommand.run(['--env', 'dev', '--config-dir', configDir, 'api/key', 'some-value']);

        await RmCommand.run(['--env', 'dev', '--config-dir', configDir, 'api/key']);

        const envDef = await loadEnvironment(tmpDir, 'dev');
        expect(envDef.values).toEqual({ app: { name: 'my-app' } });
    });
});
