import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import SetCommand from '../../src/commands/set.js';
import { saveEnvironment } from '../../src/core/environment.js';
import { LocalProvider } from '../../src/providers/local.js';
import { SecretRef } from '../../src/core/types.js';
import * as inputModule from '../../src/core/input.js';

describe('set command', () => {
    let tmpDir: string;
    let origCwd: string;
    let configDir: string;
    let logSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-set-'));
        configDir = path.join(tmpDir, '.config');
        origCwd = process.cwd();
        process.chdir(tmpDir);
        fs.mkdirSync(path.join(tmpDir, '.keyshelf', 'environments'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ name: 'test-project', provider: { adapter: 'local' } })
        );
        logSpy = vi.fn();
        vi.spyOn(SetCommand.prototype, 'log').mockImplementation(logSpy);
    });

    afterEach(() => {
        process.chdir(origCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('sets a secret value for an existing SecretRef', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { password: new SecretRef('database/password') } }
        });

        await SetCommand.run([
            '--env',
            'dev',
            'database/password',
            'mysecret',
            '--config-dir',
            configDir
        ]);

        const provider = new LocalProvider(configDir);
        const stored = await provider.get('dev', 'database/password');
        expect(stored).toBe('mysecret');
    });

    it('errors when path does not exist in config', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: {}
        });

        await expect(
            SetCommand.run([
                '--env',
                'dev',
                'database/password',
                'newpassword',
                '--config-dir',
                configDir
            ])
        ).rejects.toThrow(/Path "database\/password" not found in environment "dev"/);
    });

    it('errors when path is a plain value, not a secret', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { password: 'plain-text' } }
        });

        await expect(
            SetCommand.run([
                '--env',
                'dev',
                'database/password',
                'newvalue',
                '--config-dir',
                configDir
            ])
        ).rejects.toThrow(/plain value, not a secret reference/);
    });

    it('propagates to child environments that import the target env', async () => {
        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: { shared: { key: new SecretRef('shared/key') } }
        });
        await saveEnvironment(tmpDir, 'dev', {
            imports: ['base'],
            values: {}
        });

        await SetCommand.run([
            '--env',
            'base',
            'shared/key',
            'propagated-value',
            '--config-dir',
            configDir
        ]);

        const provider = new LocalProvider(configDir);
        const baseValue = await provider.get('base', 'shared/key');
        expect(baseValue).toBe('propagated-value');

        const devValue = await provider.get('dev', 'shared/key');
        expect(devValue).toBe('propagated-value');

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('dev'));
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('shared/key'));
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('base'));
    });

    it('prompts interactively when value arg is omitted', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { api: { key: new SecretRef('api/key') } }
        });

        vi.spyOn(inputModule, 'readMaskedLine').mockResolvedValue('prompted-secret');

        await SetCommand.run(['--env', 'dev', 'api/key', '--config-dir', configDir]);

        expect(inputModule.readMaskedLine).toHaveBeenCalledWith(expect.stringContaining('api/key'));

        const provider = new LocalProvider(configDir);
        const stored = await provider.get('dev', 'api/key');
        expect(stored).toBe('prompted-secret');
    });

    it('errors with helpful message if environment does not exist', async () => {
        await expect(
            SetCommand.run([
                '--env',
                'nonexistent',
                'some/path',
                'value',
                '--config-dir',
                configDir
            ])
        ).rejects.toThrow(/nonexistent/);
    });
});
