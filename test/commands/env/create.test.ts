import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Create from '../../../src/commands/env/create.js';
import { loadEnvironment } from '../../../src/core/environment.js';

describe('env:create command', () => {
    let tmpDir: string;
    let origCwd: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-env-create-'));
        origCwd = process.cwd();
        process.chdir(tmpDir);
        fs.mkdirSync(path.join(tmpDir, '.keyshelf', 'environments'), { recursive: true });
    });

    afterEach(() => {
        process.chdir(origCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('creates environment YAML file with empty values', async () => {
        await Create.run(['dev']);

        const def = await loadEnvironment(tmpDir, 'dev');
        expect(def.imports).toEqual([]);
        expect(def.values).toEqual({});
    });

    it('creates environment YAML file with --import flag', async () => {
        await Create.run(['dev', '--import', 'base']);

        const def = await loadEnvironment(tmpDir, 'dev');
        expect(def.imports).toEqual(['base']);
    });

    it('supports multiple --import flags', async () => {
        await Create.run(['staging', '--import', 'base', '--import', 'shared']);

        const def = await loadEnvironment(tmpDir, 'staging');
        expect(def.imports).toEqual(['base', 'shared']);
    });

    it('creates environment with --adapter local', async () => {
        await Create.run(['dev', '--adapter', 'local']);

        const def = await loadEnvironment(tmpDir, 'dev');
        expect(def.provider).toEqual({ adapter: 'local' });
    });

    it('creates environment with --adapter gcp-sm --project', async () => {
        await Create.run(['prod', '--adapter', 'gcp-sm', '--project', 'myapp-prod']);

        const def = await loadEnvironment(tmpDir, 'prod');
        expect(def.provider).toEqual({ adapter: 'gcp-sm', project: 'myapp-prod' });
    });

    it('errors if gcp-sm adapter without --project', async () => {
        await expect(Create.run(['prod', '--adapter', 'gcp-sm'])).rejects.toThrow(
            /--project is required/
        );
    });

    it('creates environment without provider when no --adapter flag', async () => {
        await Create.run(['dev']);

        const def = await loadEnvironment(tmpDir, 'dev');
        expect(def.provider).toBeUndefined();
    });

    it('creates environment with --adapter aws-sm and optional flags', async () => {
        await Create.run(['prod', '--adapter', 'aws-sm', '--region', 'eu-west-1']);

        const def = await loadEnvironment(tmpDir, 'prod');
        expect(def.provider).toEqual({ adapter: 'aws-sm', region: 'eu-west-1' });
    });

    it('creates environment with --adapter aws-sm without optional flags', async () => {
        await Create.run(['prod', '--adapter', 'aws-sm']);

        const def = await loadEnvironment(tmpDir, 'prod');
        expect(def.provider).toEqual({ adapter: 'aws-sm' });
    });

    it('errors if environment already exists', async () => {
        await Create.run(['dev']);
        await expect(Create.run(['dev'])).rejects.toThrow(/already exists/);
    });
});
