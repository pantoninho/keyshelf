import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import Show from '../../src/commands/show.js';
import { saveEnvironment } from '../../src/core/environment.js';
import { LocalProvider } from '../../src/providers/local.js';
import { SecretRef } from '../../src/core/types.js';

describe('show command', () => {
    let tmpDir: string;
    let origCwd: string;
    let configDir: string;
    let logSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-show-'));
        configDir = path.join(tmpDir, '.config');
        origCwd = process.cwd();
        process.chdir(tmpDir);
        fs.mkdirSync(path.join(tmpDir, '.keyshelf', 'environments'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ name: 'test-project', provider: { adapter: 'local' } })
        );
        logSpy = vi.fn();
        vi.spyOn(Show.prototype, 'log').mockImplementation(logSpy);
    });

    afterEach(() => {
        process.chdir(origCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    describe('--paths mode', () => {
        it('lists all leaf paths', async () => {
            await saveEnvironment(tmpDir, 'dev', {
                imports: [],
                values: {
                    database: {
                        host: 'localhost',
                        password: new SecretRef('database/password')
                    },
                    api: { key: new SecretRef('api/key') }
                }
            });

            await Show.run(['--env', 'dev', '--paths']);

            const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
            expect(output).toContain('database/host');
            expect(output).toContain('database/password');
            expect(output).toContain('api/key');
        });

        it('shows (secret) suffix for SecretRef paths', async () => {
            await saveEnvironment(tmpDir, 'dev', {
                imports: [],
                values: {
                    database: { password: new SecretRef('database/password') }
                }
            });

            await Show.run(['--env', 'dev', '--paths']);

            const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
            expect(output).toContain('database/password (secret)');
        });

        it('does NOT show (secret) for plain config paths', async () => {
            await saveEnvironment(tmpDir, 'dev', {
                imports: [],
                values: { database: { host: 'localhost' } }
            });

            await Show.run(['--env', 'dev', '--paths']);

            const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
            expect(output).toContain('database/host');
            expect(output).not.toContain('(secret)');
        });

        it('shows inherited paths from imports', async () => {
            await saveEnvironment(tmpDir, 'base', {
                imports: [],
                values: { shared: 'from-base' }
            });
            await saveEnvironment(tmpDir, 'dev', {
                imports: ['base'],
                values: { local: 'from-dev' }
            });

            await Show.run(['--env', 'dev', '--paths']);

            const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
            expect(output).toContain('shared');
            expect(output).toContain('local');
        });

        it('errors if combined with --reveal', async () => {
            await saveEnvironment(tmpDir, 'dev', { imports: [], values: {} });
            await expect(Show.run(['--env', 'dev', '--paths', '--reveal'])).rejects.toThrow(
                /--paths cannot be combined with --format or --reveal/
            );
        });

        it('errors if combined with --format json', async () => {
            await saveEnvironment(tmpDir, 'dev', { imports: [], values: {} });
            await expect(Show.run(['--env', 'dev', '--paths', '--format', 'json'])).rejects.toThrow(
                /--paths cannot be combined with --format or --reveal/
            );
        });
    });

    describe('yaml format (default)', () => {
        it('prints resolved config tree as YAML', async () => {
            await saveEnvironment(tmpDir, 'dev', {
                imports: [],
                values: { database: { host: 'localhost', port: 5432 } }
            });

            await Show.run(['--env', 'dev', '--config-dir', configDir]);

            const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
            expect(output).toContain('host: localhost');
            expect(output).toContain('port: 5432');
        });

        it('shows <secret> placeholder for secrets by default (no provider calls needed)', async () => {
            await saveEnvironment(tmpDir, 'dev', {
                imports: [],
                values: {
                    database: {
                        host: 'localhost',
                        password: new SecretRef('database/password')
                    }
                }
            });

            await Show.run(['--env', 'dev', '--config-dir', configDir]);

            const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
            expect(output).toContain('<secret>');
            expect(output).not.toContain('database/password');
        });

        it('--reveal shows actual secret values', async () => {
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

            await Show.run(['--env', 'dev', '--reveal', '--config-dir', configDir]);

            const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
            expect(output).toContain('s3cret');
            expect(output).not.toContain('<secret>');
        });

        it('includes inherited values from imports', async () => {
            await saveEnvironment(tmpDir, 'base', {
                imports: [],
                values: { shared: 'from-base' }
            });
            await saveEnvironment(tmpDir, 'dev', {
                imports: ['base'],
                values: { local: 'from-dev' }
            });

            await Show.run(['--env', 'dev', '--config-dir', configDir]);

            const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
            expect(output).toContain('shared: from-base');
            expect(output).toContain('local: from-dev');
        });
    });

    describe('json format', () => {
        it('outputs tree shape with <secret> placeholder when not revealing', async () => {
            const provider = new LocalProvider(configDir);
            await provider.set('dev', 'database/password', 's3cret');
            await saveEnvironment(tmpDir, 'dev', {
                imports: [],
                values: {
                    database: {
                        host: 'localhost',
                        port: 5432,
                        password: new SecretRef('database/password')
                    }
                }
            });

            await Show.run(['--env', 'dev', '--format', 'json', '--config-dir', configDir]);

            const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
            const parsed = JSON.parse(output);
            expect(parsed).toEqual({
                database: {
                    host: 'localhost',
                    port: 5432,
                    password: '<secret>'
                }
            });
        });

        it('--format json --reveal outputs tree with resolved secret values', async () => {
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

            await Show.run([
                '--env',
                'dev',
                '--format',
                'json',
                '--reveal',
                '--config-dir',
                configDir
            ]);

            const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
            const parsed = JSON.parse(output);
            expect(parsed).toEqual({
                database: { host: 'localhost', password: 's3cret' }
            });
        });

        it('outputs tree with plain string values when no secrets', async () => {
            await saveEnvironment(tmpDir, 'dev', {
                imports: [],
                values: { key: 'val' }
            });

            await Show.run(['--env', 'dev', '--format', 'json', '--config-dir', configDir]);

            const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
            const parsed = JSON.parse(output);
            expect(parsed).toEqual({ key: 'val' });
        });
    });

    describe('env format', () => {
        it('outputs KEY=VALUE pairs for mapped paths', async () => {
            await saveEnvironment(tmpDir, 'dev', {
                imports: [],
                values: { database: { host: 'localhost', port: 5432 } }
            });
            fs.writeFileSync(
                path.join(tmpDir, '.env.keyshelf'),
                'DATABASE_HOST=database/host\nDATABASE_PORT=database/port\n'
            );

            await Show.run(['--env', 'dev', '--format', 'env', '--config-dir', configDir]);

            const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
            expect(output).toContain('DATABASE_HOST=localhost');
            expect(output).toContain('DATABASE_PORT=5432');
        });

        it('--format env --reveal shows resolved secret values', async () => {
            const provider = new LocalProvider(configDir);
            await provider.set('dev', 'api/key', 'revealed-secret');
            await saveEnvironment(tmpDir, 'dev', {
                imports: [],
                values: {
                    database: { host: 'localhost' },
                    api: { key: new SecretRef('api/key') }
                }
            });
            fs.writeFileSync(
                path.join(tmpDir, '.env.keyshelf'),
                'DATABASE_HOST=database/host\nAPI_KEY=api/key\n'
            );

            await Show.run([
                '--env',
                'dev',
                '--format',
                'env',
                '--reveal',
                '--config-dir',
                configDir
            ]);

            const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
            expect(output).toContain('DATABASE_HOST=localhost');
            expect(output).toContain('API_KEY=revealed-secret');
            expect(output).not.toContain('api/key');
        });

        it('--format env without --reveal shows refs', async () => {
            const provider = new LocalProvider(configDir);
            await provider.set('dev', 'api/key', 'secret-key');
            await saveEnvironment(tmpDir, 'dev', {
                imports: [],
                values: {
                    database: { host: 'localhost' },
                    api: { key: new SecretRef('api/key') }
                }
            });
            fs.writeFileSync(
                path.join(tmpDir, '.env.keyshelf'),
                'DATABASE_HOST=database/host\nAPI_KEY=api/key\n'
            );

            await Show.run(['--env', 'dev', '--format', 'env', '--config-dir', configDir]);

            const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
            expect(output).toContain('DATABASE_HOST=localhost');
            expect(output).toContain('API_KEY=api/key');
            expect(output).not.toContain('secret-key');
        });

        it('warns when no .env.keyshelf file is present', async () => {
            await saveEnvironment(tmpDir, 'dev', {
                imports: [],
                values: { key: 'val' }
            });
            const warnSpy = vi.fn();
            vi.spyOn(Show.prototype, 'warn').mockImplementation(warnSpy);

            await Show.run(['--env', 'dev', '--format', 'env', '--config-dir', configDir]);

            expect(warnSpy).toHaveBeenCalledWith(
                'No .env.keyshelf file found — no environment variables will be injected.'
            );
        });
    });

    describe('walk-up discovery', () => {
        it('--format env from a subdirectory uses the subdirectory .env.keyshelf', async () => {
            await saveEnvironment(tmpDir, 'dev', {
                imports: [],
                values: { app: { name: 'myapp', port: 3000 } }
            });

            const subDir = path.join(tmpDir, 'packages', 'web');
            fs.mkdirSync(subDir, { recursive: true });
            fs.writeFileSync(path.join(subDir, '.env.keyshelf'), 'APP_PORT=app/port\n');
            process.chdir(subDir);

            await Show.run(['--env', 'dev', '--format', 'env']);

            const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
            expect(output).toContain('APP_PORT=3000');
            expect(output).not.toContain('APP_NAME');
        });

        it('yaml format from a subdirectory resolves config from the project root', async () => {
            await saveEnvironment(tmpDir, 'dev', {
                imports: [],
                values: { database: { host: 'db.internal', port: 5432 } }
            });

            const subDir = path.join(tmpDir, 'packages', 'web');
            fs.mkdirSync(subDir, { recursive: true });
            process.chdir(subDir);

            await Show.run(['--env', 'dev']);

            const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
            expect(output).toContain('host: db.internal');
            expect(output).toContain('port: 5432');
        });
    });
});
