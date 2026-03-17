import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import { spawnSync } from 'node:child_process';
import { saveEnvironment } from '../src/core/environment.js';
import { LocalProvider } from '../src/providers/local.js';
import { SecretRef } from '../src/core/types.js';

const PRELOAD_PATH = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../dist/preload.js'
);

describe('keyshelf/preload', () => {
    let tmpDir: string;
    let configDir: string;
    let outFile: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-preload-'));
        configDir = path.join(tmpDir, '.config');
        outFile = path.join(tmpDir, 'output.txt');
        fs.mkdirSync(path.join(tmpDir, '.keyshelf', 'environments'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ name: 'test-project', provider: { adapter: 'local' } })
        );
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function runPreload(script: string, env: Record<string, string | undefined>, cwd?: string) {
        const result = spawnSync(
            'node',
            ['--import', `file://${PRELOAD_PATH}`, '--input-type=module'],
            { input: script, env: { ...process.env, ...env }, cwd }
        );
        if (result.error) throw result.error;
        return {
            status: result.status,
            stderr: result.stderr?.toString() ?? '',
            output: fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf-8') : ''
        };
    }

    it('injects resolved config values into process.env', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { host: 'localhost', port: 5432 } }
        });
        fs.writeFileSync(
            path.join(tmpDir, '.env.keyshelf'),
            'DATABASE_HOST=database/host\nDATABASE_PORT=database/port\n'
        );

        const script = `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(outFile)}, process.env.DATABASE_HOST + ":" + process.env.DATABASE_PORT)`;
        const result = runPreload(script, {
            KEYSHELF_ENV: 'dev',
            KEYSHELF_PROJECT_DIR: tmpDir
        });

        expect(result.status, result.stderr).toBe(0);
        expect(result.output).toBe('localhost:5432');
    });

    it('injects resolved secret values into process.env', async () => {
        const provider = new LocalProvider(configDir);
        await provider.set('prod', 'api/key', 'super-secret-key');

        await saveEnvironment(tmpDir, 'prod', {
            imports: [],
            values: {
                api: { key: new SecretRef('api/key'), url: 'https://api.example.com' }
            }
        });
        fs.writeFileSync(path.join(tmpDir, '.env.keyshelf'), 'API_KEY=api/key\nAPI_URL=api/url\n');

        const script = `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(outFile)}, process.env.API_KEY + "|" + process.env.API_URL)`;
        const result = runPreload(script, {
            KEYSHELF_ENV: 'prod',
            KEYSHELF_PROJECT_DIR: tmpDir,
            KEYSHELF_CONFIG_DIR: configDir
        });

        expect(result.status, result.stderr).toBe(0);
        expect(result.output).toBe('super-secret-key|https://api.example.com');
    });

    it('throws a clear error when KEYSHELF_ENV is not set', async () => {
        const result = runPreload('console.log("should not reach")', {
            KEYSHELF_ENV: undefined,
            KEYSHELF_PROJECT_DIR: tmpDir
        });

        expect(result.status).not.toBe(0);
        expect(result.stderr).toMatch(/KEYSHELF_ENV is required when using keyshelf\/preload/);
    });

    it('merges inherited values from imported environments', async () => {
        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: { shared: 'from-base' }
        });
        await saveEnvironment(tmpDir, 'dev', {
            imports: ['base'],
            values: { local: 'from-dev' }
        });
        fs.writeFileSync(path.join(tmpDir, '.env.keyshelf'), 'SHARED=shared\nLOCAL=local\n');

        const script = `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(outFile)}, process.env.SHARED + "|" + process.env.LOCAL)`;
        const result = runPreload(script, {
            KEYSHELF_ENV: 'dev',
            KEYSHELF_PROJECT_DIR: tmpDir
        });

        expect(result.status, result.stderr).toBe(0);
        expect(result.output).toBe('from-base|from-dev');
    });

    it('defaults project dir to cwd when KEYSHELF_PROJECT_DIR is not set', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { app: { name: 'from-cwd' } }
        });

        const script = `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(outFile)}, process.env.APP_NAME)`;
        const result = runPreload(
            script,
            { KEYSHELF_ENV: 'dev', KEYSHELF_PROJECT_DIR: undefined },
            tmpDir
        );

        expect(result.status, result.stderr).toBe(0);
        expect(result.output).toBe('from-cwd');
    });
});
