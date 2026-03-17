import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import Import from '../../src/commands/import.js';
import { loadEnvironment, saveEnvironment } from '../../src/core/environment.js';
import { LocalProvider } from '../../src/providers/local.js';
import { SecretRef } from '../../src/core/types.js';

describe('import command', () => {
    let tmpDir: string;
    let origCwd: string;
    let configDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-env-load-'));
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
    });

    it('loads KEY=VALUE pairs as config values', async () => {
        await saveEnvironment(tmpDir, 'dev', { imports: [], values: {} });
        const envFile = path.join(tmpDir, '.env');
        fs.writeFileSync(envFile, 'DATABASE_HOST=localhost\nDATABASE_PORT=5432\n');

        await Import.run(['--env', 'dev', envFile]);

        const def = await loadEnvironment(tmpDir, 'dev');
        expect(def.values).toEqual({
            DATABASE_HOST: 'localhost',
            DATABASE_PORT: '5432'
        });
    });

    it('skips comments and blank lines', async () => {
        await saveEnvironment(tmpDir, 'dev', { imports: [], values: {} });
        const envFile = path.join(tmpDir, '.env');
        fs.writeFileSync(envFile, '# comment\n\nKEY=val\n\n# another\n');

        await Import.run(['--env', 'dev', envFile]);

        const def = await loadEnvironment(tmpDir, 'dev');
        expect(def.values).toEqual({ KEY: 'val' });
    });

    it('handles quoted values', async () => {
        await saveEnvironment(tmpDir, 'dev', { imports: [], values: {} });
        const envFile = path.join(tmpDir, '.env');
        fs.writeFileSync(envFile, 'KEY="hello world"\nKEY2=\'single\'\n');

        await Import.run(['--env', 'dev', envFile]);

        const def = await loadEnvironment(tmpDir, 'dev');
        expect(def.values).toEqual({ KEY: 'hello world', KEY2: 'single' });
    });

    it('--prefix flag nests all values under a path', async () => {
        await saveEnvironment(tmpDir, 'dev', { imports: [], values: {} });
        const envFile = path.join(tmpDir, '.env');
        fs.writeFileSync(envFile, 'HOST=localhost\nPORT=5432\n');

        await Import.run(['--env', 'dev', envFile, '--prefix', 'database']);

        const def = await loadEnvironment(tmpDir, 'dev');
        expect(def.values).toEqual({
            database: { HOST: 'localhost', PORT: '5432' }
        });
    });

    it('--secrets flag treats all values as secrets', async () => {
        await saveEnvironment(tmpDir, 'dev', { imports: [], values: {} });
        const envFile = path.join(tmpDir, '.env');
        fs.writeFileSync(envFile, 'API_KEY=sk_123\nDB_PASS=s3cret\n');

        await Import.run(['--env', 'dev', envFile, '--secrets', '--config-dir', configDir]);

        const def = await loadEnvironment(tmpDir, 'dev');
        expect(def.values.API_KEY).toBeInstanceOf(SecretRef);
        expect(def.values.DB_PASS).toBeInstanceOf(SecretRef);

        const provider = new LocalProvider(configDir);
        expect(await provider.get('dev', 'API_KEY')).toBe('sk_123');
        expect(await provider.get('dev', 'DB_PASS')).toBe('s3cret');
    });

    it('preserves env-level provider after loading values', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: {},
            provider: { adapter: 'local' }
        });
        const envFile = path.join(tmpDir, '.env');
        fs.writeFileSync(envFile, 'KEY=val\n');

        await Import.run(['--env', 'dev', envFile]);

        const def = await loadEnvironment(tmpDir, 'dev');
        expect(def.provider).toEqual({ adapter: 'local' });
    });

    it('preserves env-level provider after loading secrets', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: {},
            provider: { adapter: 'local' }
        });
        const envFile = path.join(tmpDir, '.env');
        fs.writeFileSync(envFile, 'API_KEY=sk_123\n');

        await Import.run(['--env', 'dev', envFile, '--secrets', '--config-dir', configDir]);

        const def = await loadEnvironment(tmpDir, 'dev');
        expect(def.provider).toEqual({ adapter: 'local' });
    });

    it('errors if env file not found', async () => {
        await saveEnvironment(tmpDir, 'dev', { imports: [], values: {} });
        await expect(Import.run(['--env', 'dev', '/nonexistent/.env'])).rejects.toThrow();
    });
});
