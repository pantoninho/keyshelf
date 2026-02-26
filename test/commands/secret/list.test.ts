import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import SecretList from '../../../src/commands/secret/list.js';
import { saveEnvironment } from '../../../src/core/environment.js';
import { SecretRef } from '../../../src/core/types.js';

describe('secret:list command', () => {
    let tmpDir: string;
    let origCwd: string;
    let logSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-secret-list-'));
        origCwd = process.cwd();
        process.chdir(tmpDir);
        fs.mkdirSync(path.join(tmpDir, '.keyshelf', 'environments'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ name: 'test-project', provider: { adapter: 'local' } })
        );
        logSpy = vi.fn();
        vi.spyOn(SecretList.prototype, 'log').mockImplementation(logSpy);
    });

    afterEach(() => {
        process.chdir(origCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('lists all secret paths in resolved environment', async () => {
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

        await SecretList.run(['dev']);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('database/password');
        expect(output).toContain('api/key');
        expect(output).not.toContain('database/host');
    });

    it('lists secrets under a prefix', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: {
                database: { password: new SecretRef('database/password') },
                api: { key: new SecretRef('api/key') }
            }
        });

        await SecretList.run(['dev', '--prefix', 'database']);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('database/password');
        expect(output).not.toContain('api/key');
    });

    it('shows inherited secrets from imports', async () => {
        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: { shared: { secret: new SecretRef('shared/secret') } }
        });
        await saveEnvironment(tmpDir, 'dev', {
            imports: ['base'],
            values: { local: { key: new SecretRef('local/key') } }
        });

        await SecretList.run(['dev']);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('shared/secret');
        expect(output).toContain('local/key');
    });
});
