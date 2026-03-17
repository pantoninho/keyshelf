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

    it('copies secret from grandparent through intermediate when intermediate already has it in provider', async () => {
        const provider = new LocalProvider(configDir);
        await provider.set('base', 'shared/token', 'grandparent-token');
        // staging already has the token (from a previous up run or set) so prod can copy from it
        await provider.set('staging', 'shared/token', 'grandparent-token');

        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: { shared: { token: new SecretRef('shared/token') } }
        });
        await saveEnvironment(tmpDir, 'staging', {
            imports: ['base'],
            values: { shared: { token: new SecretRef('shared/token') } }
        });
        await saveEnvironment(tmpDir, 'prod', {
            imports: ['staging'],
            values: { shared: { token: new SecretRef('shared/token') } }
        });

        vi.spyOn(Up.prototype, 'log').mockImplementation(() => {});

        await Up.run(['--apply', '--config-dir', configDir]);

        const prodToken = await provider.get('prod', 'shared/token');
        expect(prodToken).toBe('grandparent-token');
    });

    it('removes secret from all inheriting children when removed from parent YAML', async () => {
        const provider = new LocalProvider(configDir);
        await provider.set('base', 'old/secret', 'stale-value');
        await provider.set('staging', 'old/secret', 'stale-value');
        await provider.set('prod', 'old/secret', 'stale-value');

        // Parent no longer has the secret ref — it was removed from the YAML
        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: { other: { key: 'plain-value' } }
        });
        await saveEnvironment(tmpDir, 'staging', {
            imports: ['base'],
            values: {}
        });
        await saveEnvironment(tmpDir, 'prod', {
            imports: ['staging'],
            values: {}
        });

        vi.spyOn(Up.prototype, 'log').mockImplementation(() => {});

        await Up.run(['--apply', '--config-dir', configDir]);

        await expect(provider.get('base', 'old/secret')).rejects.toThrow(/not found/);
        await expect(provider.get('staging', 'old/secret')).rejects.toThrow(/not found/);
        await expect(provider.get('prod', 'old/secret')).rejects.toThrow(/not found/);
    });

    it('uses first parent as copy source when multiple parents export the same secret path', async () => {
        const provider = new LocalProvider(configDir);
        await provider.set('shared', 'api/key', 'value-from-shared');
        await provider.set('staging', 'api/key', 'value-from-staging');

        await saveEnvironment(tmpDir, 'shared', {
            imports: [],
            values: { api: { key: new SecretRef('api/key') } }
        });
        await saveEnvironment(tmpDir, 'staging', {
            imports: [],
            values: { api: { key: new SecretRef('api/key') } }
        });
        // prod imports shared first, then staging — shared should win
        await saveEnvironment(tmpDir, 'prod', {
            imports: ['shared', 'staging'],
            values: { api: { key: new SecretRef('api/key') } }
        });

        vi.spyOn(Up.prototype, 'log').mockImplementation(() => {});

        await Up.run(['--apply', '--config-dir', configDir]);

        const prodValue = await provider.get('prod', 'api/key');
        expect(prodValue).toBe('value-from-shared');
    });

    it('copies from direct parent in a 3-level chain when each level is pre-populated', async () => {
        const provider = new LocalProvider(configDir);
        // base and staging are already reconciled; prod needs to be populated from staging
        await provider.set('base', 'db/password', 'base-secret');
        await provider.set('staging', 'db/password', 'base-secret');

        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: { db: { password: new SecretRef('db/password') } }
        });
        await saveEnvironment(tmpDir, 'staging', {
            imports: ['base'],
            values: { db: { password: new SecretRef('db/password') } }
        });
        await saveEnvironment(tmpDir, 'prod', {
            imports: ['staging'],
            values: { db: { password: new SecretRef('db/password') } }
        });

        vi.spyOn(Up.prototype, 'log').mockImplementation(() => {});

        await Up.run(['--apply', '--config-dir', configDir]);

        expect(await provider.get('prod', 'db/password')).toBe('base-secret');
    });

    it('propagates apply through diamond dependency when intermediates already have the secret', async () => {
        const provider = new LocalProvider(configDir);
        await provider.set('base', 'shared/token', 'base-token');
        // infra and app already have the token so prod can copy from its direct parents
        await provider.set('infra', 'shared/token', 'base-token');
        await provider.set('app', 'shared/token', 'base-token');

        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: { shared: { token: new SecretRef('shared/token') } }
        });
        await saveEnvironment(tmpDir, 'infra', {
            imports: ['base'],
            values: { shared: { token: new SecretRef('shared/token') } }
        });
        await saveEnvironment(tmpDir, 'app', {
            imports: ['base'],
            values: { shared: { token: new SecretRef('shared/token') } }
        });
        await saveEnvironment(tmpDir, 'prod', {
            imports: ['infra', 'app'],
            values: { shared: { token: new SecretRef('shared/token') } }
        });

        vi.spyOn(Up.prototype, 'log').mockImplementation(() => {});

        await Up.run(['--apply', '--config-dir', configDir]);

        expect(await provider.get('prod', 'shared/token')).toBe('base-token');
    });

    it('surfaces provider error when set throws during apply', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { db: { password: new SecretRef('db/password') } }
        });

        vi.spyOn(LocalProvider.prototype, 'set').mockRejectedValue(
            new Error('Provider connection refused')
        );

        vi.spyOn(Up.prototype, 'log').mockImplementation(() => {});

        const secretsFile = path.join(tmpDir, 'secrets.env');
        fs.writeFileSync(secretsFile, 'db/password=test-value\n');

        await expect(
            Up.run(['--apply', '--from-file', secretsFile, '--config-dir', configDir])
        ).rejects.toThrow(/Provider connection refused/);
    });
});
