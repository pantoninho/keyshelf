import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import Get from '../../src/commands/get.js';
import Show from '../../src/commands/show.js';
import { saveEnvironment } from '../../src/core/environment.js';
import { SecretRef } from '../../src/core/types.js';
import { SecretProvider } from '../../src/providers/provider.js';
import { providerConfig, providerLabel, createTestProvider } from './provider-fixture.js';

describe(`get and show commands (e2e against ${providerLabel})`, () => {
    let tmpDir: string;
    let origCwd: string;
    let configDir: string;
    let provider: SecretProvider;
    let secretsToCleanup: Array<{ env: string; path: string }>;

    beforeEach(() => {
        const projectName = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-e2e-read-'));
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
        vi.restoreAllMocks();

        for (const { env, path: secretPath } of secretsToCleanup) {
            try {
                await provider.delete(env, secretPath);
            } catch {
                // Ignore
            }
        }
    });

    describe('get', () => {
        it('retrieves a secret value from the provider', async () => {
            secretsToCleanup.push({ env: 'dev', path: 'db/password' });
            await provider.set('dev', 'db/password', 'real-secret-from-aws');
            await saveEnvironment(tmpDir, 'dev', {
                imports: [],
                values: { db: { password: new SecretRef('db/password') } }
            });

            const logSpy = vi.fn();
            vi.spyOn(Get.prototype, 'log').mockImplementation(logSpy);

            await Get.run(['--env', 'dev', '--config-dir', configDir, 'db/password']);

            expect(logSpy).toHaveBeenCalledWith('real-secret-from-aws');
        });

        it('retrieves an inherited secret from the provider', async () => {
            secretsToCleanup.push({ env: 'dev', path: 'shared/key' });
            await provider.set('dev', 'shared/key', 'inherited-aws-secret');
            await saveEnvironment(tmpDir, 'base', {
                imports: [],
                values: { shared: { key: new SecretRef('shared/key') } }
            });
            await saveEnvironment(tmpDir, 'dev', {
                imports: ['base'],
                values: {}
            });

            const logSpy = vi.fn();
            vi.spyOn(Get.prototype, 'log').mockImplementation(logSpy);

            await Get.run(['--env', 'dev', '--config-dir', configDir, 'shared/key']);

            expect(logSpy).toHaveBeenCalledWith('inherited-aws-secret');
        });
    });

    describe('show --reveal', () => {
        it('reveals secret values in yaml format', async () => {
            secretsToCleanup.push({ env: 'dev', path: 'api/key' });
            await provider.set('dev', 'api/key', 'revealed-aws-secret');
            await saveEnvironment(tmpDir, 'dev', {
                imports: [],
                values: {
                    api: { key: new SecretRef('api/key') },
                    app: { name: 'my-app' }
                }
            });

            const logSpy = vi.fn();
            vi.spyOn(Show.prototype, 'log').mockImplementation(logSpy);

            await Show.run(['--env', 'dev', '--config-dir', configDir, '--reveal']);

            const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
            expect(output).toContain('revealed-aws-secret');
            expect(output).toContain('my-app');
        });

        it('reveals secret values in json format', async () => {
            secretsToCleanup.push({ env: 'dev', path: 'db/password' });
            await provider.set('dev', 'db/password', 'json-revealed-secret');
            await saveEnvironment(tmpDir, 'dev', {
                imports: [],
                values: {
                    db: {
                        host: 'localhost',
                        password: new SecretRef('db/password')
                    }
                }
            });

            const logSpy = vi.fn();
            vi.spyOn(Show.prototype, 'log').mockImplementation(logSpy);

            await Show.run([
                '--env',
                'dev',
                '--config-dir',
                configDir,
                '--format',
                'json',
                '--reveal'
            ]);

            const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
            const parsed = JSON.parse(output);
            expect(parsed).toEqual({
                db: { host: 'localhost', password: 'json-revealed-secret' }
            });
        });

        it('reveals secret values in env format', async () => {
            secretsToCleanup.push({ env: 'dev', path: 'api/key' });
            await provider.set('dev', 'api/key', 'env-revealed-secret');
            await saveEnvironment(tmpDir, 'dev', {
                imports: [],
                values: {
                    api: { key: new SecretRef('api/key') },
                    app: { port: 3000 }
                }
            });
            fs.writeFileSync(
                path.join(tmpDir, '.env.keyshelf'),
                'API_KEY=api/key\nAPP_PORT=app/port\n'
            );

            const logSpy = vi.fn();
            vi.spyOn(Show.prototype, 'log').mockImplementation(logSpy);

            await Show.run([
                '--env',
                'dev',
                '--config-dir',
                configDir,
                '--format',
                'env',
                '--reveal'
            ]);

            const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
            expect(output).toContain('API_KEY=env-revealed-secret');
            expect(output).toContain('APP_PORT=3000');
        });
    });
});
