import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import List from '../../src/commands/list.js';
import { saveEnvironment } from '../../src/core/environment.js';
import { SecretRef } from '../../src/core/types.js';

describe('list command', () => {
    let tmpDir: string;
    let origCwd: string;
    let logSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-list-'));
        origCwd = process.cwd();
        process.chdir(tmpDir);
        fs.mkdirSync(path.join(tmpDir, '.keyshelf', 'environments'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ name: 'test-project', provider: { adapter: 'local' } })
        );
        logSpy = vi.fn();
        vi.spyOn(List.prototype, 'log').mockImplementation(logSpy);
    });

    afterEach(() => {
        process.chdir(origCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('lists all paths (both config and secret) in resolved environment', async () => {
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

        await List.run(['--env', 'dev']);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('database/host');
        expect(output).toContain('database/password');
        expect(output).toContain('api/key');
    });

    it('shows (secret) suffix for SecretRef paths', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: {
                database: {
                    password: new SecretRef('database/password')
                }
            }
        });

        await List.run(['--env', 'dev']);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('database/password (secret)');
    });

    it('does NOT show (secret) for plain config paths', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { host: 'localhost' } }
        });

        await List.run(['--env', 'dev']);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('database/host');
        expect(output).not.toContain('(secret)');
    });

    it('shows inherited values from imports', async () => {
        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: { shared: 'from-base' }
        });
        await saveEnvironment(tmpDir, 'dev', {
            imports: ['base'],
            values: { local: 'from-dev' }
        });

        await List.run(['--env', 'dev']);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('shared');
        expect(output).toContain('local');
    });

    it('errors if env does not exist', async () => {
        await expect(List.run(['--env', 'nonexistent'])).rejects.toThrow(/nonexistent/);
    });

    it('produces no output for an environment with no values', async () => {
        await saveEnvironment(tmpDir, 'empty', {
            imports: [],
            values: {}
        });

        await List.run(['--env', 'empty']);

        expect(logSpy).not.toHaveBeenCalled();
    });
});
