import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import ConfigGet from '../../../src/commands/config/get.js';
import { saveEnvironment } from '../../../src/core/environment.js';

describe('config:get command', () => {
    let tmpDir: string;
    let origCwd: string;
    let logSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-config-get-'));
        origCwd = process.cwd();
        process.chdir(tmpDir);
        fs.mkdirSync(path.join(tmpDir, '.keyshelf', 'environments'), { recursive: true });
        logSpy = vi.fn();
        vi.spyOn(ConfigGet.prototype, 'log').mockImplementation(logSpy);
    });

    afterEach(() => {
        process.chdir(origCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('gets a config value from environment', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { host: 'localhost' } }
        });

        await ConfigGet.run(['dev', 'database/host']);
        expect(logSpy).toHaveBeenCalledWith('localhost');
    });

    it('gets a value inherited from an imported environment', async () => {
        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: { database: { port: 5432 } }
        });
        await saveEnvironment(tmpDir, 'dev', {
            imports: ['base'],
            values: { database: { host: 'localhost' } }
        });

        await ConfigGet.run(['dev', 'database/port']);
        expect(logSpy).toHaveBeenCalledWith('5432');
    });

    it('local value overrides imported value', async () => {
        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: { database: { host: 'prod-db' } }
        });
        await saveEnvironment(tmpDir, 'dev', {
            imports: ['base'],
            values: { database: { host: 'localhost' } }
        });

        await ConfigGet.run(['dev', 'database/host']);
        expect(logSpy).toHaveBeenCalledWith('localhost');
    });

    it('returns subtree when path points to an object', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { host: 'localhost', port: 5432 } }
        });

        await ConfigGet.run(['dev', 'database']);
        const output = logSpy.mock.calls[0][0] as string;
        expect(output).toContain('host');
        expect(output).toContain('localhost');
    });

    it('errors if path not found', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { host: 'localhost' } }
        });

        await expect(ConfigGet.run(['dev', 'missing/path'])).rejects.toThrow(/missing\/path/);
    });
});
