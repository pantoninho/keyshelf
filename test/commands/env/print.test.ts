import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import EnvPrint from '../../../src/commands/env/print.js';
import { saveEnvironment } from '../../../src/core/environment.js';
import { LocalProvider } from '../../../src/providers/local.js';
import { SecretRef } from '../../../src/core/types.js';

describe('env:print command', () => {
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
        vi.spyOn(EnvPrint.prototype, 'log').mockImplementation(logSpy);
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

        await EnvPrint.run(['dev', '--config-dir', configDir]);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('host: localhost');
        expect(output).toContain('port: 5432');
    });

    it('masks secret values by default', async () => {
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

        await EnvPrint.run(['dev', '--config-dir', configDir]);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('********');
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

        await EnvPrint.run(['dev', '--reveal', '--config-dir', configDir]);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('s3cret');
    });

    it('--format json outputs JSON', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { key: 'val' }
        });

        await EnvPrint.run(['dev', '--format', 'json', '--config-dir', configDir]);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        const parsed = JSON.parse(output);
        expect(parsed).toEqual({ key: 'val' });
    });

    it('--format env outputs KEY=VALUE pairs', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { host: 'localhost', port: 5432 } }
        });

        await EnvPrint.run(['dev', '--format', 'env', '--config-dir', configDir]);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('DATABASE_HOST=localhost');
        expect(output).toContain('DATABASE_PORT=5432');
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

        await EnvPrint.run(['dev', '--config-dir', configDir]);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('shared: from-base');
        expect(output).toContain('local: from-dev');
    });
});
