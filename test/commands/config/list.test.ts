import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import ConfigList from '../../../src/commands/config/list.js';
import { saveEnvironment } from '../../../src/core/environment.js';
import { SecretRef } from '../../../src/core/types.js';

describe('config:list command', () => {
    let tmpDir: string;
    let origCwd: string;
    let logSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-config-list-'));
        origCwd = process.cwd();
        process.chdir(tmpDir);
        fs.mkdirSync(path.join(tmpDir, '.keyshelf', 'environments'), { recursive: true });
        logSpy = vi.fn();
        vi.spyOn(ConfigList.prototype, 'log').mockImplementation(logSpy);
    });

    afterEach(() => {
        process.chdir(origCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('lists all config paths in resolved environment', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { host: 'localhost', port: 5432 } }
        });

        await ConfigList.run(['dev']);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('database/host');
        expect(output).toContain('database/port');
    });

    it('lists paths under a prefix', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { host: 'localhost' }, api: { key: 'abc' } }
        });

        await ConfigList.run(['dev', '--prefix', 'database']);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('database/host');
        expect(output).not.toContain('api/key');
    });

    it('excludes !secret refs from output', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: {
                database: {
                    host: 'localhost',
                    password: new SecretRef('db/password')
                }
            }
        });

        await ConfigList.run(['dev']);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('database/host');
        expect(output).not.toContain('database/password');
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

        await ConfigList.run(['dev']);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('shared');
        expect(output).toContain('local');
    });
});
