import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import SetCommand from '../../src/commands/set.js';
import { saveEnvironment, loadEnvironment } from '../../src/core/environment.js';
import { AwsSmProvider } from '../../src/providers/aws-sm.js';
import { SecretRef } from '../../src/core/types.js';

describe('set command (e2e against real AWS SM)', () => {
    let tmpDir: string;
    let origCwd: string;
    let provider: AwsSmProvider;
    let secretsToCleanup: Array<{ env: string; path: string }>;

    beforeEach(() => {
        const projectName = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-e2e-set-'));
        origCwd = process.cwd();
        process.chdir(tmpDir);
        fs.mkdirSync(path.join(tmpDir, '.keyshelf', 'environments'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ name: projectName, provider: { adapter: 'aws-sm' } })
        );
        provider = new AwsSmProvider({ name: projectName });
        secretsToCleanup = [];
    });

    afterEach(async () => {
        process.chdir(origCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });

        for (const { env, path: secretPath } of secretsToCleanup) {
            try {
                await provider.delete(env, secretPath);
            } catch {
                // Ignore — secret may already be deleted or not yet created
            }
        }
    });

    it('sets a secret value in AWS SM', async () => {
        secretsToCleanup.push({ env: 'dev', path: 'api/key' });
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { api: { key: new SecretRef('api/key') } }
        });

        await SetCommand.run(['--env', 'dev', 'api/key', 'e2e-api-key-value']);

        const value = await provider.get('dev', 'api/key');
        expect(value).toBe('e2e-api-key-value');
    });

    it('creates SecretRef in YAML when path does not exist', async () => {
        secretsToCleanup.push({ env: 'dev', path: 'new/secret' });
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: {}
        });

        await SetCommand.run(['--env', 'dev', 'new/secret', 'brand-new-value']);

        const envDef = await loadEnvironment(tmpDir, 'dev');
        const { new: newNode } = envDef.values as { new: { secret: unknown } };
        expect(newNode.secret).toBeInstanceOf(SecretRef);

        const value = await provider.get('dev', 'new/secret');
        expect(value).toBe('brand-new-value');
    });

    it('propagates secret to child environments in AWS SM', async () => {
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

        await SetCommand.run(['--env', 'base', 'shared/token', 'propagated-e2e-value']);

        const baseValue = await provider.get('base', 'shared/token');
        expect(baseValue).toBe('propagated-e2e-value');

        const stagingValue = await provider.get('staging', 'shared/token');
        expect(stagingValue).toBe('propagated-e2e-value');
    });
});
