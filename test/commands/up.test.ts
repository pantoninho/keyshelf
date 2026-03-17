import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import readline from 'node:readline';
import Up from '../../src/commands/up.js';
import { saveEnvironment } from '../../src/core/environment.js';
import { LocalProvider } from '../../src/providers/local.js';
import { SecretRef } from '../../src/core/types.js';

describe('up command', () => {
    let tmpDir: string;
    let origCwd: string;
    let configDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-up-'));
        configDir = path.join(tmpDir, '.config');
        origCwd = process.cwd();
        process.chdir(tmpDir);
        fs.mkdirSync(path.join(tmpDir, '.keyshelf', 'environments'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ name: 'test-project', provider: { adapter: 'local' } })
        );
    });

    afterEach(() => {
        process.chdir(origCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('prints "No environments found." when no environments exist', async () => {
        const logs: string[] = [];
        vi.spyOn(Up.prototype, 'log').mockImplementation((msg = '') => {
            logs.push(msg);
        });

        await Up.run(['--config-dir', configDir]);

        expect(logs.some((l) => l.includes('No environments found.'))).toBe(true);
    });

    it('shows "Nothing to do." when provider already has all secrets', async () => {
        const provider = new LocalProvider(configDir);
        await provider.set('dev', 'db/password', 'existing-secret');
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { db: { password: new SecretRef('db/password') } }
        });

        const logs: string[] = [];
        vi.spyOn(Up.prototype, 'log').mockImplementation((msg = '') => {
            logs.push(msg);
        });

        await Up.run(['--config-dir', configDir]);

        expect(logs.some((l) => l.includes('Nothing to do.'))).toBe(true);
    });

    it('shows add change for a new secret in the plan', async () => {
        const secretsFile = path.join(tmpDir, 'secrets.env');
        fs.writeFileSync(secretsFile, 'db/password=test-value\n');

        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { db: { password: new SecretRef('db/password') } }
        });

        const logs: string[] = [];
        vi.spyOn(Up.prototype, 'log').mockImplementation((msg = '') => {
            logs.push(msg);
        });

        // Use --apply and --from-file to avoid interactive prompt while still testing plan output
        await Up.run(['--apply', '--from-file', secretsFile, '--config-dir', configDir]);

        const allOutput = logs.join('\n');
        expect(allOutput).toContain('db/password');
        expect(allOutput).toContain('(new)');
    });

    it('applies an add change with --apply and --from-file', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { db: { password: new SecretRef('db/password') } }
        });

        const secretsFile = path.join(tmpDir, 'secrets.env');
        fs.writeFileSync(secretsFile, 'db/password=my-secret-value\n');

        const logs: string[] = [];
        vi.spyOn(Up.prototype, 'log').mockImplementation((msg = '') => {
            logs.push(msg);
        });

        await Up.run(['--apply', '--from-file', secretsFile, '--config-dir', configDir]);

        expect(logs.some((l) => l.includes('Done.'))).toBe(true);

        const provider = new LocalProvider(configDir);
        const value = await provider.get('dev', 'db/password');
        expect(value).toBe('my-secret-value');
    });

    it('applies a remove change with --apply and --from-file', async () => {
        const provider = new LocalProvider(configDir);
        await provider.set('dev', 'old/key', 'stale-secret');
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { db: { host: 'localhost' } }
        });

        const secretsFile = path.join(tmpDir, 'secrets.env');
        fs.writeFileSync(secretsFile, '');

        const logs: string[] = [];
        vi.spyOn(Up.prototype, 'log').mockImplementation((msg = '') => {
            logs.push(msg);
        });

        await Up.run(['--apply', '--from-file', secretsFile, '--config-dir', configDir]);

        expect(logs.some((l) => l.includes('Done.'))).toBe(true);
        await expect(provider.get('dev', 'old/key')).rejects.toThrow(/not found/);
    });

    it('handles parent-child environments and copies secrets from parent', async () => {
        const provider = new LocalProvider(configDir);
        await provider.set('base', 'shared/token', 'base-token');

        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: { shared: { token: new SecretRef('shared/token') } }
        });
        await saveEnvironment(tmpDir, 'dev', {
            imports: ['base'],
            values: { shared: { token: new SecretRef('shared/token') } }
        });

        const logs: string[] = [];
        vi.spyOn(Up.prototype, 'log').mockImplementation((msg = '') => {
            logs.push(msg);
        });

        await Up.run(['--apply', '--config-dir', configDir]);

        expect(logs.some((l) => l.includes('Done.'))).toBe(true);

        const devToken = await provider.get('dev', 'shared/token');
        expect(devToken).toBe('base-token');
    });

    it('does not apply changes when --apply is not passed and user declines', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { db: { password: new SecretRef('db/password') } }
        });

        // Simulate user answering 'n' to the confirmation prompt
        vi.spyOn(readline, 'createInterface').mockReturnValue({
            question: (_prompt: string, cb: (answer: string) => void) => cb('n'),
            close: vi.fn()
        } as unknown as readline.Interface);

        const setSpy = vi.spyOn(LocalProvider.prototype, 'set');

        vi.spyOn(Up.prototype, 'log').mockImplementation(() => {});

        await Up.run(['--config-dir', configDir]);

        expect(setSpy).not.toHaveBeenCalled();
    });

    it('processes environments in topological order (parent before child)', async () => {
        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: {}
        });
        await saveEnvironment(tmpDir, 'dev', {
            imports: ['base'],
            values: {}
        });

        const logs: string[] = [];
        vi.spyOn(Up.prototype, 'log').mockImplementation((msg = '') => {
            logs.push(msg);
        });

        await Up.run(['--config-dir', configDir]);

        const allOutput = logs.join('\n');
        const baseIdx = allOutput.indexOf('Environment: base');
        const devIdx = allOutput.indexOf('Environment: dev');
        expect(baseIdx).toBeLessThan(devIdx);
    });
});
