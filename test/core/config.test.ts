import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import { loadConfig } from '../../src/core/config.js';

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
            yaml.dump({ name: 'test', provider: { adapter: 'aws-sm' } })
        );

        expect(() => loadConfig(tmpDir)).toThrow(/unknown adapter "aws-sm"/i);
        expect(() => loadConfig(tmpDir)).toThrow(/local/);
    });
});
