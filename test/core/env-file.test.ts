import { describe, it, expect } from 'vitest';
import { parseEnvFile } from '../../src/core/env-file.js';

describe('parseEnvFile', () => {
    it('parses basic key=value pairs', () => {
        const result = parseEnvFile('FOO=bar\nBAZ=qux\n');
        expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
    });

    it('strips double-quoted values', () => {
        const result = parseEnvFile('SECRET="my secret value"');
        expect(result).toEqual({ SECRET: 'my secret value' });
    });

    it('strips single-quoted values', () => {
        const result = parseEnvFile("SECRET='my secret value'");
        expect(result).toEqual({ SECRET: 'my secret value' });
    });

    it('skips comment lines starting with #', () => {
        const result = parseEnvFile('# this is a comment\nFOO=bar\n');
        expect(result).toEqual({ FOO: 'bar' });
    });

    it('skips blank lines', () => {
        const result = parseEnvFile('\n\nFOO=bar\n\n');
        expect(result).toEqual({ FOO: 'bar' });
    });

    it('skips lines without an = sign', () => {
        const result = parseEnvFile('NOTAKEY\nFOO=bar\n');
        expect(result).toEqual({ FOO: 'bar' });
    });

    it('trims whitespace around keys', () => {
        const result = parseEnvFile('  FOO  =bar');
        expect(result).toEqual({ FOO: 'bar' });
    });

    it('trims whitespace around values', () => {
        const result = parseEnvFile('FOO=  bar  ');
        expect(result).toEqual({ FOO: 'bar' });
    });

    it('returns empty record for empty content', () => {
        const result = parseEnvFile('');
        expect(result).toEqual({});
    });
});
