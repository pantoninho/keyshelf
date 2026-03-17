import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import Up from '../../src/commands/up.js';
import { saveEnvironment } from '../../src/core/environment.js';
import { SecretRef } from '../../src/core/types.js';
import { SecretProvider } from '../../src/providers/provider.js';
import { providerConfig, providerLabel, createTestProvider } from './provider-fixture.js';

describe(`up command (e2e against ${providerLabel})`, () => {
    let tmpDir: string;
    let origCwd: string;
    let provider: SecretProvider;
    /** Tracks every {env, path} pair that might exist in the provider, for deterministic cleanup. */
    let secretsToCleanup: Array<{ env: string; path: string }>;

    beforeEach(() => {
        const projectName = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-e2e-up-'));
        origCwd = process.cwd();
        process.chdir(tmpDir);
        fs.mkdirSync(path.join(tmpDir, '.keyshelf', 'environments'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ name: projectName, provider: providerConfig })
        );
        provider = createTestProvider(projectName);
        secretsToCleanup = [];
    });

    afterEach(async () => {
        process.chdir(origCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });

        for (const { env, path: secretPath } of secretsToCleanup) {
            try {
                await provider.delete(env, secretPath);
            } catch {
                // Ignore — secret may already be deleted by the test or not yet created
            }
        }
    });

    it('creates new secrets in the provider', async () => {
        secretsToCleanup.push({ env: 'dev', path: 'db/password' });
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { db: { password: new SecretRef('db/password') } }
        });

        const secretsFile = path.join(tmpDir, 'secrets.env');
        fs.writeFileSync(secretsFile, 'db/password=e2e-secret-value\n');

        await Up.run(['--apply', '--from-file', secretsFile]);

        const value = await provider.get('dev', 'db/password');
        expect(value).toBe('e2e-secret-value');
    });

    it('deletes stale secrets from the provider', async () => {
        secretsToCleanup.push({ env: 'dev', path: 'old/stale-key' });
        await provider.set('dev', 'old/stale-key', 'stale-value');
        await waitForSecretInList(provider, 'dev', 'old/stale-key');

        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { db: { host: 'localhost' } }
        });

        const secretsFile = path.join(tmpDir, 'secrets.env');
        fs.writeFileSync(secretsFile, '');

        await Up.run(['--apply', '--from-file', secretsFile]);

        await expect(provider.get('dev', 'old/stale-key')).rejects.toThrow(
            /not found|marked for deletion/
        );
    });

    it('copies secrets from parent to child environment', async () => {
        secretsToCleanup.push(
            { env: 'base', path: 'shared/token' },
            { env: 'dev', path: 'shared/token' }
        );
        await provider.set('base', 'shared/token', 'base-token-value');
        await waitForSecretInList(provider, 'base', 'shared/token');

        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: { shared: { token: new SecretRef('shared/token') } }
        });
        await saveEnvironment(tmpDir, 'dev', {
            imports: ['base'],
            values: { shared: { token: new SecretRef('shared/token') } }
        });

        await Up.run(['--apply']);

        const value = await provider.get('dev', 'shared/token');
        expect(value).toBe('base-token-value');
    });

    it('does nothing when provider already has all secrets', async () => {
        secretsToCleanup.push({ env: 'dev', path: 'db/password' });
        await provider.set('dev', 'db/password', 'already-set');
        await waitForSecretInList(provider, 'dev', 'db/password');

        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { db: { password: new SecretRef('db/password') } }
        });

        await Up.run(['--apply']);

        const value = await provider.get('dev', 'db/password');
        expect(value).toBe('already-set');
    });
});

async function waitForSecretInList(
    provider: SecretProvider,
    env: string,
    secretPath: string,
    timeoutMs = 30_000
): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const paths = await provider.list(env);
        if (paths.includes(secretPath)) return;
        await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(
        `Secret "${secretPath}" did not appear in list for env "${env}" within ${timeoutMs}ms`
    );
}
