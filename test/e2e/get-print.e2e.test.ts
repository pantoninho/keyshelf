import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import Get from '../../src/commands/get.js';
import Print from '../../src/commands/print.js';
import { saveEnvironment } from '../../src/core/environment.js';
import { AwsSmProvider } from '../../src/providers/aws-sm.js';
import { SecretRef } from '../../src/core/types.js';

describe('get and print commands (e2e against real AWS SM)', () => {
    let tmpDir: string;
    let origCwd: string;
    let provider: AwsSmProvider;
    let secretsToCleanup: Array<{ env: string; path: string }>;

    beforeEach(() => {
        const projectName = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-e2e-read-'));
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
        it('retrieves a secret value from AWS SM', async () => {
            secretsToCleanup.push({ env: 'dev', path: 'db/password' });
            await provider.set('dev', 'db/password', 'real-secret-from-aws');
            await saveEnvironment(tmpDir, 'dev', {
                imports: [],
                values: { db: { password: new SecretRef('db/password') } }
            });

            const logSpy = vi.fn();
            vi.spyOn(Get.prototype, 'log').mockImplementation(logSpy);

            await Get.run(['--env', 'dev', 'db/password']);

            expect(logSpy).toHaveBeenCalledWith('real-secret-from-aws');
        });

        it('retrieves an inherited secret from AWS SM', async () => {
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

            await Get.run(['--env', 'dev', 'shared/key']);

            expect(logSpy).toHaveBeenCalledWith('inherited-aws-secret');
        });
    });

    describe('print --reveal', () => {
        it('reveals secret values from AWS SM in yaml format', async () => {
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
            vi.spyOn(Print.prototype, 'log').mockImplementation(logSpy);

            await Print.run(['--env', 'dev', '--reveal']);

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
            vi.spyOn(Print.prototype, 'log').mockImplementation(logSpy);

            await Print.run(['--env', 'dev', '--format', 'json', '--reveal']);

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

            const logSpy = vi.fn();
            vi.spyOn(Print.prototype, 'log').mockImplementation(logSpy);

            await Print.run(['--env', 'dev', '--format', 'env', '--reveal']);

            const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
            expect(output).toContain('API_KEY=env-revealed-secret');
            expect(output).toContain('APP_PORT=3000');
        });
    });
});
