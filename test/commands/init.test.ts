import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import Init from '../../src/commands/init.js';

describe('init command', () => {
    let tmpDir: string;
    let origCwd: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-init-'));
        origCwd = process.cwd();
        process.chdir(tmpDir);
    });

    afterEach(() => {
        process.chdir(origCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('creates keyshelf.yml with default config', async () => {
        await Init.run([]);

        const configPath = path.join(tmpDir, 'keyshelf.yml');
        expect(fs.existsSync(configPath)).toBe(true);

        const content = fs.readFileSync(configPath, 'utf-8');
        const config = yaml.load(content) as Record<string, unknown>;
        expect(config.name).toBe(path.basename(tmpDir));
        expect(config.provider).toEqual({ adapter: 'local' });
    });

    it('creates .keyshelf/environments/ directory', async () => {
        await Init.run([]);

        const envDir = path.join(tmpDir, '.keyshelf', 'environments');
        expect(fs.existsSync(envDir)).toBe(true);
    });

    it('errors if keyshelf.yml already exists', async () => {
        fs.writeFileSync(path.join(tmpDir, 'keyshelf.yml'), 'existing: true');

        await expect(Init.run([])).rejects.toThrow(/already exists/);
    });

    it('--force overwrites existing keyshelf.yml', async () => {
        fs.writeFileSync(path.join(tmpDir, 'keyshelf.yml'), 'existing: true');

        await Init.run(['--force']);

        const content = fs.readFileSync(path.join(tmpDir, 'keyshelf.yml'), 'utf-8');
        const config = yaml.load(content) as Record<string, unknown>;
        expect(config.provider).toEqual({ adapter: 'local' });
    });

    it('--adapter gcp-sm with --project creates gcp-sm config', async () => {
        await Init.run(['--adapter', 'gcp-sm', '--project', 'my-gcp-project']);

        const content = fs.readFileSync(path.join(tmpDir, 'keyshelf.yml'), 'utf-8');
        const config = yaml.load(content) as Record<string, unknown>;
        expect(config.provider).toEqual({ adapter: 'gcp-sm', project: 'my-gcp-project' });
    });

    it('--adapter gcp-sm without --project errors', async () => {
        await expect(Init.run(['--adapter', 'gcp-sm'])).rejects.toThrow(/--project is required/);
    });

    it('--adapter aws-sm creates aws-sm config', async () => {
        await Init.run(['--adapter', 'aws-sm', '--profile', 'dev']);

        const content = fs.readFileSync(path.join(tmpDir, 'keyshelf.yml'), 'utf-8');
        const config = yaml.load(content) as Record<string, unknown>;
        expect(config.provider).toEqual({ adapter: 'aws-sm', profile: 'dev' });
    });

    it('--adapter aws-sm works without optional flags', async () => {
        await Init.run(['--adapter', 'aws-sm']);

        const content = fs.readFileSync(path.join(tmpDir, 'keyshelf.yml'), 'utf-8');
        const config = yaml.load(content) as Record<string, unknown>;
        expect(config.provider).toEqual({ adapter: 'aws-sm' });
    });
});
