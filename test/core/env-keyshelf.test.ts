import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadEnvMapping, ENV_KEYSHELF_FILENAME } from '../../src/core/env-keyshelf.js';

describe('loadEnvMapping', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-env-keyshelf-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns parsed mappings when file exists', () => {
        fs.writeFileSync(
            path.join(tmpDir, ENV_KEYSHELF_FILENAME),
            'DATABASE_URL=database/url\nAPI_KEY=api/key\n'
        );

        const result = loadEnvMapping(tmpDir);

        expect(result).toEqual({ DATABASE_URL: 'database/url', API_KEY: 'api/key' });
    });

    it('returns empty record when file does not exist', () => {
        const result = loadEnvMapping(tmpDir);

        expect(result).toEqual({});
    });

    it('handles comments and blank lines', () => {
        fs.writeFileSync(
            path.join(tmpDir, ENV_KEYSHELF_FILENAME),
            '# This is a comment\n\nDATABASE_URL=database/url\n\n# Another comment\nAPI_KEY=api/key\n'
        );

        const result = loadEnvMapping(tmpDir);

        expect(result).toEqual({ DATABASE_URL: 'database/url', API_KEY: 'api/key' });
    });

    it('strips surrounding quotes from values', () => {
        fs.writeFileSync(
            path.join(tmpDir, ENV_KEYSHELF_FILENAME),
            'MY_VAR="some/path"\nOTHER_VAR=\'other/path\'\n'
        );

        const result = loadEnvMapping(tmpDir);

        expect(result).toEqual({ MY_VAR: 'some/path', OTHER_VAR: 'other/path' });
    });
});
