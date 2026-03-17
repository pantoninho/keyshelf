import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import { saveEnvironment } from '../../src/core/environment.js';
import { LocalProvider } from '../../src/providers/local.js';
import { SecretRef } from '../../src/core/types.js';
import { resolveEnv } from '../../src/core/resolve-env.js';

describe('resolveEnv', () => {
    let tmpDir: string;
    let configDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-resolve-env-'));
        configDir = path.join(tmpDir, '.config');
        fs.mkdirSync(path.join(tmpDir, '.keyshelf', 'environments'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ name: 'test-project', provider: { adapter: 'local' } })
        );
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('resolves plain config values to a flat env record', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { host: 'localhost', port: 5432 } }
        });

        const result = await resolveEnv({
            env: 'dev',
            projectDir: tmpDir,
            configDir,
            envMapping: { DATABASE_HOST: 'database/host', DATABASE_PORT: 'database/port' }
        });

        expect(result).toEqual({
            DATABASE_HOST: 'localhost',
            DATABASE_PORT: '5432'
        });
    });

    it('resolves secret refs to actual values', async () => {
        const provider = new LocalProvider(configDir);
        await provider.set('prod', 'api/key', 'super-secret-key');

        await saveEnvironment(tmpDir, 'prod', {
            imports: [],
            values: {
                api: { key: new SecretRef('api/key'), url: 'https://api.example.com' }
            }
        });

        const result = await resolveEnv({
            env: 'prod',
            projectDir: tmpDir,
            configDir,
            envMapping: { API_KEY: 'api/key', API_URL: 'api/url' }
        });

        expect(result).toEqual({
            API_KEY: 'super-secret-key',
            API_URL: 'https://api.example.com'
        });
    });

    it('merges inherited values from imports', async () => {
        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: { shared: 'from-base' }
        });
        await saveEnvironment(tmpDir, 'dev', {
            imports: ['base'],
            values: { local: 'from-dev' }
        });

        const result = await resolveEnv({
            env: 'dev',
            projectDir: tmpDir,
            configDir,
            envMapping: { SHARED: 'shared', LOCAL: 'local' }
        });

        expect(result).toEqual({
            SHARED: 'from-base',
            LOCAL: 'from-dev'
        });
    });

    it('child env values override parent values', async () => {
        await saveEnvironment(tmpDir, 'base', {
            imports: [],
            values: { setting: 'base-value' }
        });
        await saveEnvironment(tmpDir, 'dev', {
            imports: ['base'],
            values: { setting: 'dev-value' }
        });

        const result = await resolveEnv({
            env: 'dev',
            projectDir: tmpDir,
            configDir,
            envMapping: { SETTING: 'setting' }
        });

        expect(result).toEqual({ SETTING: 'dev-value' });
    });

    it('returns empty record when envMapping is empty', async () => {
        await saveEnvironment(tmpDir, 'dev', {
            imports: [],
            values: { database: { host: 'localhost', port: 5432 } }
        });

        const result = await resolveEnv({
            env: 'dev',
            projectDir: tmpDir,
            configDir,
            envMapping: {}
        });

        expect(result).toEqual({});
    });

    it('throws when environment does not exist', async () => {
        await expect(
            resolveEnv({ env: 'nonexistent', projectDir: tmpDir, configDir, envMapping: {} })
        ).rejects.toThrow(/Environment "nonexistent" not found/);
    });

    it('throws when keyshelf.yml is missing', async () => {
        const noConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-noconfig-'));
        try {
            fs.mkdirSync(path.join(noConfigDir, '.keyshelf', 'environments'), { recursive: true });
            await saveEnvironment(noConfigDir, 'dev', { imports: [], values: { key: 'val' } });
            await expect(
                resolveEnv({ env: 'dev', projectDir: noConfigDir, configDir, envMapping: {} })
            ).rejects.toThrow(/keyshelf.yml not found/);
        } finally {
            fs.rmSync(noConfigDir, { recursive: true, force: true });
        }
    });
});
