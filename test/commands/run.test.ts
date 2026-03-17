import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import Run from '../../src/commands/run.js';
import { saveEnvironment } from '../../src/core/environment.js';
import { LocalProvider } from '../../src/providers/local.js';
import { SecretRef } from '../../src/core/types.js';

describe('run command', () => {
    let tmpDir: string;
    let origCwd: string;
    let configDir: string;
    let outFile: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-run-'));
        configDir = path.join(tmpDir, '.config');
        outFile = path.join(tmpDir, 'output.txt');
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

    it('runs a command with resolved config values as env vars', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { host: 'localhost', port: 5432 } }
        });
        fs.writeFileSync(
            path.join(tmpDir, '.env.keyshelf'),
            'DATABASE_HOST=database/host\nDATABASE_PORT=database/port\n'
        );

        const exitSpy = vi.spyOn(Run.prototype, 'exit').mockImplementation(() => {
            throw new Error('EXIT');
        });

        const script = `require("fs").writeFileSync(${JSON.stringify(outFile)}, process.env.DATABASE_HOST + ":" + process.env.DATABASE_PORT)`;
        await runAndCatch(['--env', 'dev', '--config-dir', configDir, '--', 'node', '-e', script]);

        const output = fs.readFileSync(outFile, 'utf-8');
        expect(output).toBe('localhost:5432');
        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('injects resolved secret values into env vars', async () => {
        const provider = new LocalProvider(configDir);
        await provider.set('prod', 'api/key', 'super-secret-key');
        await saveEnvironment(tmpDir, 'prod', {
            imports: [],
            values: {
                api: { key: new SecretRef('api/key'), url: 'https://api.example.com' }
            }
        });
        fs.writeFileSync(path.join(tmpDir, '.env.keyshelf'), 'API_KEY=api/key\nAPI_URL=api/url\n');

        const exitSpy = vi.spyOn(Run.prototype, 'exit').mockImplementation(() => {
            throw new Error('EXIT');
        });

        const script = `require("fs").writeFileSync(${JSON.stringify(outFile)}, process.env.API_KEY + "|" + process.env.API_URL)`;
        await runAndCatch(['--env', 'prod', '--config-dir', configDir, '--', 'node', '-e', script]);

        const output = fs.readFileSync(outFile, 'utf-8');
        expect(output).toBe('super-secret-key|https://api.example.com');
        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('merges with existing process.env', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { app: 'myapp' }
        });
        fs.writeFileSync(path.join(tmpDir, '.env.keyshelf'), 'APP=app\n');

        const exitSpy = vi.spyOn(Run.prototype, 'exit').mockImplementation(() => {
            throw new Error('EXIT');
        });

        const script = `require("fs").writeFileSync(${JSON.stringify(outFile)}, (process.env.PATH ? "has_path" : "no_path") + "|" + process.env.APP)`;
        await runAndCatch(['--env', 'dev', '--config-dir', configDir, '--', 'node', '-e', script]);

        const output = fs.readFileSync(outFile, 'utf-8');
        expect(output).toContain('has_path|myapp');
        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('forwards subprocess exit code', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { key: 'val' }
        });
        fs.writeFileSync(path.join(tmpDir, '.env.keyshelf'), 'KEY=key\n');

        const exitSpy = vi.spyOn(Run.prototype, 'exit').mockImplementation(() => {
            throw new Error('EXIT');
        });

        await runAndCatch([
            '--env',
            'dev',
            '--config-dir',
            configDir,
            '--',
            'node',
            '-e',
            'process.exit(42)'
        ]);

        expect(exitSpy).toHaveBeenCalledWith(42);
    });

    it('warns when no .env.keyshelf file is present', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { key: 'val' }
        });

        const warnSpy = vi.spyOn(Run.prototype, 'warn').mockImplementation(() => {
            return undefined as never;
        });
        const exitSpy = vi.spyOn(Run.prototype, 'exit').mockImplementation(() => {
            throw new Error('EXIT');
        });

        await runAndCatch(['--env', 'dev', '--config-dir', configDir, '--', 'node', '-e', '1']);

        expect(warnSpy).toHaveBeenCalledWith(
            'No .env.keyshelf file found — no environment variables will be injected.'
        );
        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('errors when no command is provided after --', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { key: 'val' }
        });

        await expect(Run.run(['--env', 'dev', '--config-dir', configDir])).rejects.toThrow(
            /No command specified/
        );
    });

    it('errors when environment does not exist', async () => {
        await expect(
            Run.run(['--env', 'nonexistent', '--config-dir', configDir, '--', 'echo', 'hi'])
        ).rejects.toThrow(/Environment "nonexistent" not found/);
    });

    it('errors when spawned command does not exist (ENOENT)', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { key: 'val' }
        });

        await expect(
            Run.run([
                '--env',
                'dev',
                '--config-dir',
                configDir,
                '--',
                'nonexistent-command-xyz-abc'
            ])
        ).rejects.toThrow(/Failed to run command/);
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
        fs.writeFileSync(path.join(tmpDir, '.env.keyshelf'), 'SHARED=shared\nLOCAL=local\n');

        const exitSpy = vi.spyOn(Run.prototype, 'exit').mockImplementation(() => {
            throw new Error('EXIT');
        });

        const script = `require("fs").writeFileSync(${JSON.stringify(outFile)}, process.env.SHARED + "|" + process.env.LOCAL)`;
        await runAndCatch(['--env', 'dev', '--config-dir', configDir, '--', 'node', '-e', script]);

        const output = fs.readFileSync(outFile, 'utf-8');
        expect(output).toBe('from-base|from-dev');
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});

describe('walk-up discovery', () => {
    let tmpDir: string;
    let origCwd: string;
    let outFile: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-run-walkup-'));
        outFile = path.join(tmpDir, 'output.txt');
        origCwd = process.cwd();
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

    it('resolves config from project root and env mapping from cwd when run from a subdirectory', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { host: 'localhost' } }
        });

        const subDir = path.join(tmpDir, 'packages', 'api');
        fs.mkdirSync(subDir, { recursive: true });
        fs.writeFileSync(path.join(subDir, '.env.keyshelf'), 'DATABASE_HOST=database/host\n');
        process.chdir(subDir);

        const exitSpy = vi.spyOn(Run.prototype, 'exit').mockImplementation(() => {
            throw new Error('EXIT');
        });

        const script = `require("fs").writeFileSync(${JSON.stringify(outFile)}, process.env.DATABASE_HOST)`;
        await runAndCatch(['--env', 'dev', '--', 'node', '-e', script]);

        const output = fs.readFileSync(outFile, 'utf-8');
        expect(output).toBe('localhost');
        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('does not load .env.keyshelf from the project root when run from a subdirectory without one', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { host: 'localhost' } }
        });

        fs.writeFileSync(path.join(tmpDir, '.env.keyshelf'), 'ROOT_VAR=database/host\n');

        const subDir = path.join(tmpDir, 'packages', 'api');
        fs.mkdirSync(subDir, { recursive: true });
        process.chdir(subDir);

        const warnSpy = vi.spyOn(Run.prototype, 'warn').mockImplementation(() => {
            return undefined as never;
        });
        const exitSpy = vi.spyOn(Run.prototype, 'exit').mockImplementation(() => {
            throw new Error('EXIT');
        });

        await runAndCatch(['--env', 'dev', '--', 'node', '-e', '1']);

        expect(warnSpy).toHaveBeenCalledWith(
            'No .env.keyshelf file found — no environment variables will be injected.'
        );
        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('errors when no keyshelf.yml exists anywhere up the tree', async () => {
        const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-no-config-'));
        process.chdir(emptyDir);

        try {
            await expect(Run.run(['--env', 'dev', '--', 'node', '-e', '1'])).rejects.toThrow(
                /keyshelf\.yml not found/
            );
        } finally {
            fs.rmSync(emptyDir, { recursive: true, force: true });
        }
    });
});

async function runAndCatch(argv: string[]): Promise<void> {
    try {
        await Run.run(argv);
    } catch {
        // exit mock throws
    }
}
