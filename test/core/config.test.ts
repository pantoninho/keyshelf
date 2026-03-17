import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import { loadConfig, parseProviderConfig, findProjectRoot } from '../../src/core/config.js';

describe('config validation', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-config-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('loads valid keyshelf.yml', () => {
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ name: 'my-project', provider: { adapter: 'local' } })
        );

        const config = loadConfig(tmpDir);
        expect(config.name).toBe('my-project');
        expect(config.provider.adapter).toBe('local');
    });

    it('missing keyshelf.yml shows actionable error', () => {
        expect(() => loadConfig(tmpDir)).toThrow(/keyshelf\.yml not found/);
        expect(() => loadConfig(tmpDir)).toThrow(/keyshelf init/);
    });

    it('invalid YAML shows parse error', () => {
        fs.writeFileSync(path.join(tmpDir, 'keyshelf.yml'), '{ invalid yaml: [}');

        expect(() => loadConfig(tmpDir)).toThrow(/Failed to parse keyshelf\.yml/);
    });

    it('missing name field shows specific error', () => {
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ provider: { adapter: 'local' } })
        );

        expect(() => loadConfig(tmpDir)).toThrow(/missing required field "name"/);
    });

    it('name with path traversal characters is rejected', () => {
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ name: '../../.ssh', provider: { adapter: 'local' } })
        );

        expect(() => loadConfig(tmpDir)).toThrow(/unsafe characters/);
        expect(() => loadConfig(tmpDir)).toThrow(/name/);
    });

    it('name with spaces is rejected', () => {
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ name: 'my project', provider: { adapter: 'local' } })
        );

        expect(() => loadConfig(tmpDir)).toThrow(/unsafe characters/);
    });

    it('name with hyphens and underscores is accepted', () => {
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ name: 'my-project_v2', provider: { adapter: 'local' } })
        );

        const config = loadConfig(tmpDir);
        expect(config.name).toBe('my-project_v2');
    });

    it('missing provider field shows specific error', () => {
        fs.writeFileSync(path.join(tmpDir, 'keyshelf.yml'), yaml.dump({ name: 'test' }));

        expect(() => loadConfig(tmpDir)).toThrow(/missing required field "provider"/);
    });

    it('missing provider.adapter field shows specific error', () => {
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ name: 'test', provider: {} })
        );

        expect(() => loadConfig(tmpDir)).toThrow(/missing required field "provider.adapter"/);
    });

    it('unknown adapter name shows available adapters', () => {
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ name: 'test', provider: { adapter: 'vault' } })
        );

        expect(() => loadConfig(tmpDir)).toThrow(/unknown adapter "vault"/i);
        expect(() => loadConfig(tmpDir)).toThrow(/local/);
        expect(() => loadConfig(tmpDir)).toThrow(/gcp-sm/);
    });

    it('loads valid gcp-sm config with project field', () => {
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ name: 'test', provider: { adapter: 'gcp-sm', project: 'my-gcp-project' } })
        );

        const config = loadConfig(tmpDir);
        expect(config.provider).toEqual({ adapter: 'gcp-sm', project: 'my-gcp-project' });
    });

    it('gcp-sm without project field shows specific error', () => {
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ name: 'test', provider: { adapter: 'gcp-sm' } })
        );

        expect(() => loadConfig(tmpDir)).toThrow(/gcp-sm.*requires field "provider\.project"/i);
    });

    it('loads valid aws-sm config', () => {
        fs.writeFileSync(
            path.join(tmpDir, 'keyshelf.yml'),
            yaml.dump({ name: 'test', provider: { adapter: 'aws-sm' } })
        );

        const config = loadConfig(tmpDir);
        expect(config.provider).toEqual({ adapter: 'aws-sm' });
    });
});

describe('findProjectRoot', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-find-root-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('finds keyshelf.yml in startDir itself', () => {
        fs.writeFileSync(path.join(tmpDir, 'keyshelf.yml'), 'name: test\n');

        const result = findProjectRoot(tmpDir);
        expect(result).toBe(path.resolve(tmpDir));
    });

    it('finds keyshelf.yml two levels up', () => {
        fs.writeFileSync(path.join(tmpDir, 'keyshelf.yml'), 'name: test\n');
        const subDir = path.join(tmpDir, 'packages', 'app');
        fs.mkdirSync(subDir, { recursive: true });

        const result = findProjectRoot(subDir);
        expect(result).toBe(path.resolve(tmpDir));
    });

    it('returns null when keyshelf.yml is not found anywhere', () => {
        const subDir = path.join(tmpDir, 'some', 'deep', 'dir');
        fs.mkdirSync(subDir, { recursive: true });

        // Use a sub-path of tmpDir that has no keyshelf.yml, but we cannot
        // guarantee tmpDir ancestors don't have one, so use a fresh isolated path.
        // We test with a non-existent start to ensure null is returned when walking
        // up finds nothing. Instead, we write keyshelf.yml nowhere and start from
        // a deep subdir — if the test machine's tmpdir ancestors don't have keyshelf.yml
        // (they won't), this returns null.
        const result = findProjectRoot(subDir);
        expect(result).toBeNull();
    });

    it('returns the resolved absolute path', () => {
        fs.writeFileSync(path.join(tmpDir, 'keyshelf.yml'), 'name: test\n');

        const result = findProjectRoot(tmpDir);
        expect(path.isAbsolute(result!)).toBe(true);
    });
});

describe('parseProviderConfig', () => {
    it('parses local adapter', () => {
        expect(parseProviderConfig({ adapter: 'local' }, 'test')).toEqual({ adapter: 'local' });
    });

    it('parses gcp-sm adapter with project', () => {
        expect(parseProviderConfig({ adapter: 'gcp-sm', project: 'my-project' }, 'test')).toEqual({
            adapter: 'gcp-sm',
            project: 'my-project'
        });
    });

    it('uses context in error messages for missing adapter', () => {
        expect(() => parseProviderConfig({}, 'environment file')).toThrow(
            /Invalid environment file.*missing required field "provider\.adapter"/
        );
    });

    it('uses context in error messages for unknown adapter', () => {
        expect(() => parseProviderConfig({ adapter: 'vault' }, 'environment file')).toThrow(
            /Invalid environment file.*unknown adapter "vault"/
        );
    });

    it('uses context in error messages for missing gcp-sm project', () => {
        expect(() => parseProviderConfig({ adapter: 'gcp-sm' }, 'environment file')).toThrow(
            /Invalid environment file.*gcp-sm.*requires field "provider\.project"/
        );
    });
});
