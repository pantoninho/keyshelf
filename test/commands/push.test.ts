import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import Push from '../../src/commands/push.js';
import { saveEnvironment } from '../../src/core/environment.js';
import { SecretRef } from '../../src/core/types.js';
import { LocalProvider } from '../../src/providers/local.js';

// Mock createTarget to avoid shelling out to the eas CLI
vi.mock('../../src/targets/index.js', () => ({
    createTarget: vi.fn()
}));

import { createTarget } from '../../src/targets/index.js';

const mockCreateTarget = vi.mocked(createTarget);

/** Build a fake DeployTarget with controllable mocks. */
function makeFakeTarget(overrides: {
    list?: Record<string, string>;
    setSpy?: ReturnType<typeof vi.fn>;
    deleteSpy?: ReturnType<typeof vi.fn>;
}) {
    return {
        list: vi.fn().mockResolvedValue(overrides.list ?? {}),
        set: overrides.setSpy ?? vi.fn().mockResolvedValue(undefined),
        delete: overrides.deleteSpy ?? vi.fn().mockResolvedValue(undefined)
    };
}

function writePushConfig(tmpDir: string): void {
    fs.writeFileSync(
        path.join(tmpDir, 'keyshelf.yml'),
        yaml.dump({
            name: 'test-project',
            provider: { adapter: 'local' },
            targets: {
                'eas-prod': { adapter: 'eas', environment: 'production' }
            }
        })
    );
}

describe('push command', () => {
    let tmpDir: string;
    let origCwd: string;
    let configDir: string;
    let logSpy: ReturnType<typeof vi.fn>;
    let errorSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-push-'));
        configDir = path.join(tmpDir, '.config');
        origCwd = process.cwd();
        process.chdir(tmpDir);
        fs.mkdirSync(path.join(tmpDir, '.keyshelf', 'environments'), { recursive: true });

        writePushConfig(tmpDir);

        logSpy = vi.fn();
        errorSpy = vi.fn().mockImplementation((msg: string) => {
            throw new Error(msg);
        });
        vi.spyOn(Push.prototype, 'log').mockImplementation(logSpy);
        vi.spyOn(Push.prototype, 'error').mockImplementation(errorSpy as never);

        // Default: empty target
        mockCreateTarget.mockReturnValue(makeFakeTarget({}));
    });

    afterEach(() => {
        process.chdir(origCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('errors if keyshelf.yml is not found', async () => {
        fs.rmSync(path.join(tmpDir, 'keyshelf.yml'));

        await expect(
            Push.run(['--env', 'production', '--target', 'eas-prod', '--config-dir', configDir])
        ).rejects.toThrow(/keyshelf\.yml not found/);
    });

    it('errors if target is not configured', async () => {
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ name: 'test-project', provider: { adapter: 'local' } })
        );

        await expect(
            Push.run(['--env', 'production', '--target', 'eas-prod', '--config-dir', configDir])
        ).rejects.toThrow(/Target "eas-prod" is not configured/);
    });

    it('errors if .env.keyshelf is missing', async () => {
        await saveEnvironment(tmpDir, 'production', {
            imports: [],
            values: { app: { name: 'myapp' } }
        });

        await expect(
            Push.run(['--env', 'production', '--target', 'eas-prod', '--config-dir', configDir])
        ).rejects.toThrow(/\.env\.keyshelf not found/);
    });

    it('shows plan with additions on dry run', async () => {
        mockCreateTarget.mockReturnValue(makeFakeTarget({ list: {} }));

        await saveEnvironment(tmpDir, 'production', {
            imports: [],
            values: { app: { name: 'myapp' } }
        });
        fs.writeFileSync(path.join(tmpDir, '.env.keyshelf'), 'APP_NAME=app/name\n');

        await Push.run(['--env', 'production', '--target', 'eas-prod', '--config-dir', configDir]);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('+ APP_NAME');
    });

    it('does not apply changes without --apply', async () => {
        const setSpy = vi.fn().mockResolvedValue(undefined);
        mockCreateTarget.mockReturnValue(makeFakeTarget({ setSpy }));

        await saveEnvironment(tmpDir, 'production', {
            imports: [],
            values: { app: { name: 'myapp' } }
        });
        fs.writeFileSync(path.join(tmpDir, '.env.keyshelf'), 'APP_NAME=app/name\n');

        await Push.run(['--env', 'production', '--target', 'eas-prod', '--config-dir', configDir]);

        expect(setSpy).not.toHaveBeenCalled();

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('Run with --apply');
    });

    it('applies changes with --apply', async () => {
        const setSpy = vi.fn().mockResolvedValue(undefined);
        mockCreateTarget.mockReturnValue(makeFakeTarget({ setSpy }));

        await saveEnvironment(tmpDir, 'production', {
            imports: [],
            values: { app: { name: 'myapp' } }
        });
        fs.writeFileSync(path.join(tmpDir, '.env.keyshelf'), 'APP_NAME=app/name\n');

        await Push.run([
            '--env',
            'production',
            '--target',
            'eas-prod',
            '--apply',
            '--config-dir',
            configDir
        ]);

        expect(setSpy).toHaveBeenCalledWith('APP_NAME', 'myapp', false);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('Done.');
    });

    it('passes sensitive=true for secrets, sensitive=false for plain config', async () => {
        const provider = new LocalProvider(configDir);
        await provider.set('production', 'api/key', 'real-secret');

        const setSpy = vi.fn().mockResolvedValue(undefined);
        mockCreateTarget.mockReturnValue(makeFakeTarget({ setSpy }));

        await saveEnvironment(tmpDir, 'production', {
            imports: [],
            values: {
                app: { name: 'myapp' },
                api: { key: new SecretRef('api/key') }
            }
        });
        fs.writeFileSync(
            path.join(tmpDir, '.env.keyshelf'),
            'APP_NAME=app/name\nAPI_KEY=api/key\n'
        );

        await Push.run([
            '--env',
            'production',
            '--target',
            'eas-prod',
            '--apply',
            '--config-dir',
            configDir
        ]);

        const setCallsMap = Object.fromEntries(
            setSpy.mock.calls.map(([key, , sensitive]: [string, string, boolean]) => [
                key,
                sensitive
            ])
        );

        expect(setCallsMap['APP_NAME']).toBe(false);
        expect(setCallsMap['API_KEY']).toBe(true);
    });

    it('shows "No changes." when already in sync', async () => {
        mockCreateTarget.mockReturnValue(makeFakeTarget({ list: { APP_NAME: 'myapp' } }));

        await saveEnvironment(tmpDir, 'production', {
            imports: [],
            values: { app: { name: 'myapp' } }
        });
        fs.writeFileSync(path.join(tmpDir, '.env.keyshelf'), 'APP_NAME=app/name\n');

        await Push.run(['--env', 'production', '--target', 'eas-prod', '--config-dir', configDir]);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('No changes.');
    });

    it('deletes removed keys with --apply', async () => {
        const deleteSpy = vi.fn().mockResolvedValue(undefined);
        mockCreateTarget.mockReturnValue(
            makeFakeTarget({
                list: { APP_NAME: 'myapp', STALE_KEY: 'old' },
                deleteSpy
            })
        );

        await saveEnvironment(tmpDir, 'production', {
            imports: [],
            values: { app: { name: 'myapp' } }
        });
        fs.writeFileSync(path.join(tmpDir, '.env.keyshelf'), 'APP_NAME=app/name\n');

        await Push.run([
            '--env',
            'production',
            '--target',
            'eas-prod',
            '--apply',
            '--config-dir',
            configDir
        ]);

        expect(deleteSpy).toHaveBeenCalledWith('STALE_KEY');
    });

    it('shows plan with updates when values differ', async () => {
        mockCreateTarget.mockReturnValue(makeFakeTarget({ list: { APP_NAME: 'old-name' } }));

        await saveEnvironment(tmpDir, 'production', {
            imports: [],
            values: { app: { name: 'new-name' } }
        });
        fs.writeFileSync(path.join(tmpDir, '.env.keyshelf'), 'APP_NAME=app/name\n');

        await Push.run(['--env', 'production', '--target', 'eas-prod', '--config-dir', configDir]);

        const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
        expect(output).toContain('~ APP_NAME');
    });
});
