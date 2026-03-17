import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import Validate from '../../src/commands/validate.js';
import { saveEnvironment } from '../../src/core/environment.js';
import { LocalProvider } from '../../src/providers/local.js';
import { SecretRef } from '../../src/core/types.js';

describe('validate command', () => {
    let tmpDir: string;
    let origCwd: string;
    let configDir: string;
    let logSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-validate-'));
        configDir = path.join(tmpDir, '.config');
        origCwd = process.cwd();
        process.chdir(tmpDir);
        fs.mkdirSync(path.join(tmpDir, '.keyshelf', 'environments'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ name: 'test-project', provider: { adapter: 'local' } })
        );
        logSpy = vi.fn();
        vi.spyOn(Validate.prototype, 'log').mockImplementation(logSpy);
    });

    afterEach(() => {
        process.chdir(origCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('prints "No environments found." when no environments exist', async () => {
        await Validate.run(['--config-dir', configDir]);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('No environments found.');
    });

    it('reports OK when all secrets exist', async () => {
        const provider = new LocalProvider(configDir);
        await provider.set('dev', 'database/password', 's3cret');
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { password: new SecretRef('database/password') } }
        });

        await Validate.run(['--config-dir', configDir]);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('✓ dev: 1 secrets OK');
    });

    it('reports missing secrets and exits with code 1', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: {
                database: { password: new SecretRef('database/password') },
                api: { key: new SecretRef('api/key') }
            }
        });

        const exitSpy = vi.fn();
        vi.spyOn(Validate.prototype, 'exit').mockImplementation(exitSpy);

        await Validate.run(['--config-dir', configDir]);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('✗ dev: missing 2 secrets');
        expect(output).toContain('database/password');
        expect(output).toContain('api/key');
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('reports only missing secrets, not found ones', async () => {
        const provider = new LocalProvider(configDir);
        await provider.set('dev', 'database/password', 's3cret');
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: {
                database: { password: new SecretRef('database/password') },
                api: { key: new SecretRef('api/key') }
            }
        });

        const exitSpy = vi.fn();
        vi.spyOn(Validate.prototype, 'exit').mockImplementation(exitSpy);

        await Validate.run(['--config-dir', configDir]);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('✗ dev: missing 1 secrets');
        expect(output).toContain('api/key');
        expect(output).not.toContain('database/password');
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('does not call exit when all secrets are present', async () => {
        const provider = new LocalProvider(configDir);
        await provider.set('dev', 'api/key', 'secret');
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { api: { key: new SecretRef('api/key') } }
        });

        const exitSpy = vi.fn();
        vi.spyOn(Validate.prototype, 'exit').mockImplementation(exitSpy);

        await Validate.run(['--config-dir', configDir]);

        expect(exitSpy).not.toHaveBeenCalled();
    });

    it('validates all environments, not just one', async () => {
        const provider = new LocalProvider(configDir);
        await provider.set('dev', 'api/key', 'dev-secret');
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { api: { key: new SecretRef('api/key') } }
        });
        await saveEnvironment(tmpDir, 'prod', {
            imports: [],
            values: { api: { key: new SecretRef('api/key') } }
        });

        const exitSpy = vi.fn();
        vi.spyOn(Validate.prototype, 'exit').mockImplementation(exitSpy);

        await Validate.run(['--config-dir', configDir]);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('✓ dev');
        expect(output).toContain('✗ prod');
        expect(exitSpy).toHaveBeenCalledWith(1);
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

        await Validate.run(['--config-dir', configDir]);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        const baseIdx = output.indexOf('base');
        const devIdx = output.indexOf('dev');
        expect(baseIdx).toBeLessThan(devIdx);
    });

    it('OK when environment has no secrets', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { config: { key: 'plain-value' } }
        });

        const exitSpy = vi.fn();
        vi.spyOn(Validate.prototype, 'exit').mockImplementation(exitSpy);

        await Validate.run(['--config-dir', configDir]);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('✓ dev: 0 secrets OK');
        expect(exitSpy).not.toHaveBeenCalled();
    });
});
