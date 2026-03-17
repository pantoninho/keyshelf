import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import Print from '../../src/commands/print.js';
import { saveEnvironment } from '../../src/core/environment.js';
import { LocalProvider } from '../../src/providers/local.js';
import { SecretRef } from '../../src/core/types.js';

describe('print command', () => {
    let tmpDir: string;
    let origCwd: string;
    let configDir: string;
    let logSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-env-print-'));
        configDir = path.join(tmpDir, '.config');
        origCwd = process.cwd();
        process.chdir(tmpDir);
        fs.mkdirSync(path.join(tmpDir, '.keyshelf', 'environments'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ name: 'test-project', provider: { adapter: 'local' } })
        );
        logSpy = vi.fn();
        vi.spyOn(Print.prototype, 'log').mockImplementation(logSpy);
    });

    afterEach(() => {
        process.chdir(origCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('prints resolved config tree as YAML', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { host: 'localhost', port: 5432 } }
        });

        await Print.run(['--env', 'dev', '--config-dir', configDir]);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('host: localhost');
        expect(output).toContain('port: 5432');
    });

    it('shows secret refs by default', async () => {
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

        await Print.run(['--env', 'dev', '--config-dir', configDir]);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('database/password');
        expect(output).not.toContain('********');
        expect(output).not.toContain('s3cret');
    });

    it('--reveal flag shows actual secret values', async () => {
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

        await Print.run(['--env', 'dev', '--reveal', '--config-dir', configDir]);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('s3cret');
    });

    it('--format json outputs split config/secrets format', async () => {
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

        await Print.run(['--env', 'dev', '--format', 'json', '--config-dir', configDir]);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        const parsed = JSON.parse(output);
        expect(parsed).toEqual({
            config: {
                'database/host': 'localhost',
                'database/port': 5432
            },
            secrets: {
                'database/password': 'database/password'
            }
        });
    });

    it('--format json --reveal outputs hierarchical with resolved values', async () => {
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

        await Print.run([
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

    it('--format json with config-only values outputs empty secrets', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { key: 'val' }
        });

        await Print.run(['--env', 'dev', '--format', 'json', '--config-dir', configDir]);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        const parsed = JSON.parse(output);
        expect(parsed).toEqual({
            config: { key: 'val' },
            secrets: {}
        });
    });

    it('--format env outputs KEY=VALUE pairs', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { host: 'localhost', port: 5432 } }
        });
        fs.writeFileSync(
            path.join(tmpDir, '.env.keyshelf'),
            'DATABASE_HOST=database/host\nDATABASE_PORT=database/port\n'
        );

        await Print.run(['--env', 'dev', '--format', 'env', '--config-dir', configDir]);

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

        await Print.run(['--env', 'dev', '--format', 'env', '--reveal', '--config-dir', configDir]);

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

        await Print.run(['--env', 'dev', '--format', 'env', '--config-dir', configDir]);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('DATABASE_HOST=localhost');
        expect(output).toContain('API_KEY=api/key');
        expect(output).not.toContain('secret-key');
    });

    it('--format env warns when no .env.keyshelf file is present', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { key: 'val' }
        });
        const warnSpy = vi.fn();
        vi.spyOn(Print.prototype, 'warn').mockImplementation(warnSpy);

        await Print.run(['--env', 'dev', '--format', 'env', '--config-dir', configDir]);

        expect(warnSpy).toHaveBeenCalledWith(
            'No .env.keyshelf file found — no environment variables will be injected.'
        );
    });

    it('uses env-level provider over global config', async () => {
        const envConfigDir = path.join(tmpDir, '.env-config');
        const provider = new LocalProvider(envConfigDir);
        await provider.set('dev', 'api/key', 'env-secret');
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { api: { key: new SecretRef('api/key') } },
            provider: { adapter: 'local' }
        });

        await Print.run(['--env', 'dev', '--reveal', '--config-dir', envConfigDir]);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('env-secret');
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

        await Print.run(['--env', 'dev', '--config-dir', configDir]);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('shared: from-base');
        expect(output).toContain('local: from-dev');
    });
});
