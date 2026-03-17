import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EasTarget } from '../../src/targets/eas.js';

// Mock child_process at module level
vi.mock('node:child_process', () => ({
    execFile: vi.fn()
}));

import * as cp from 'node:child_process';
import { promisify } from 'node:util';

// execFile is mocked, so we need to access it directly
const execFileMock = vi.mocked(cp.execFile);

/** Helper: make execFile resolve with stdout/stderr strings. */
function mockExecFileSuccess(stdout: string): void {
    execFileMock.mockImplementation(
        (_file: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
            (callback as (err: null, result: { stdout: string; stderr: string }) => void)(null, {
                stdout,
                stderr: ''
            });
            return {} as ReturnType<typeof cp.execFile>;
        }
    );
}

/** Helper: make execFile reject with an error. */
function mockExecFileError(err: Error): void {
    execFileMock.mockImplementation(
        (_file: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
            (callback as (err: Error) => void)(err);
            return {} as ReturnType<typeof cp.execFile>;
        }
    );
}

describe('EasTarget', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('list()', () => {
        it('parses NAME=value lines from eas env:list output', async () => {
            mockExecFileSuccess('API_KEY=secret123\nDATABASE_URL=postgres://localhost/db\n');

            const target = new EasTarget('production');
            const result = await target.list();

            expect(result).toEqual({
                API_KEY: 'secret123',
                DATABASE_URL: 'postgres://localhost/db'
            });
        });

        it('passes production as positional argument to eas env:list', async () => {
            mockExecFileSuccess('');

            const target = new EasTarget('production');
            await target.list();

            expect(execFileMock).toHaveBeenCalledWith(
                'eas',
                expect.arrayContaining(['env:list', 'production']),
                expect.anything(),
                expect.any(Function)
            );
        });

        it('passes development as positional argument to eas env:list', async () => {
            mockExecFileSuccess('');

            const target = new EasTarget('development');
            await target.list();

            expect(execFileMock).toHaveBeenCalledWith(
                'eas',
                expect.arrayContaining(['env:list', 'development']),
                expect.anything(),
                expect.any(Function)
            );
        });

        it('returns empty record when no output', async () => {
            mockExecFileSuccess('');

            const target = new EasTarget('production');
            const result = await target.list();

            expect(result).toEqual({});
        });

        it('skips lines without = separator', async () => {
            mockExecFileSuccess('VALID_KEY=value\ninvalid-line\n\n');

            const target = new EasTarget('production');
            const result = await target.list();

            expect(result).toEqual({ VALID_KEY: 'value' });
        });

        it('handles values containing = characters', async () => {
            mockExecFileSuccess('JWT_SECRET=abc=def=ghi\n');

            const target = new EasTarget('production');
            const result = await target.list();

            expect(result).toEqual({ JWT_SECRET: 'abc=def=ghi' });
        });
    });

    describe('set()', () => {
        it('passes correct args for a non-sensitive key', async () => {
            mockExecFileSuccess('');

            const target = new EasTarget('production');
            await target.set('DATABASE_HOST', 'localhost', false);

            expect(execFileMock).toHaveBeenCalledWith(
                'eas',
                expect.arrayContaining([
                    'env:create',
                    '--name',
                    'DATABASE_HOST',
                    '--value',
                    'localhost',
                    '--environment',
                    'production',
                    '--visibility',
                    'plaintext',
                    '--force',
                    '--non-interactive'
                ]),
                expect.anything(),
                expect.any(Function)
            );
        });

        it('passes sensitive visibility for a sensitive key', async () => {
            mockExecFileSuccess('');

            const target = new EasTarget('production');
            await target.set('API_SECRET', 'top-secret', true);

            expect(execFileMock).toHaveBeenCalledWith(
                'eas',
                expect.arrayContaining(['--visibility', 'sensitive']),
                expect.anything(),
                expect.any(Function)
            );
        });

        it('uses plaintext visibility for a non-sensitive key', async () => {
            mockExecFileSuccess('');

            const target = new EasTarget('production');
            await target.set('HOST', 'example.com', false);

            expect(execFileMock).toHaveBeenCalledWith(
                'eas',
                expect.arrayContaining(['--visibility', 'plaintext']),
                expect.anything(),
                expect.any(Function)
            );
        });
    });

    describe('delete()', () => {
        it('passes correct args for delete', async () => {
            mockExecFileSuccess('');

            const target = new EasTarget('production');
            await target.delete('STALE_KEY');

            expect(execFileMock).toHaveBeenCalledWith(
                'eas',
                expect.arrayContaining([
                    'env:delete',
                    '--name',
                    'STALE_KEY',
                    '--environment',
                    'production',
                    '--non-interactive'
                ]),
                expect.anything(),
                expect.any(Function)
            );
        });
    });

    describe('error handling', () => {
        it('throws friendly error when eas CLI is not found (ENOENT)', async () => {
            const err = new Error('spawn eas ENOENT') as NodeJS.ErrnoException;
            err.code = 'ENOENT';
            mockExecFileError(err);

            const target = new EasTarget('production');

            await expect(target.list()).rejects.toThrow(
                'eas CLI not found. Install with: npm install -g eas-cli'
            );
        });

        it('throws EAS CLI failed error with stderr for other errors', async () => {
            const err = Object.assign(new Error('Command failed'), {
                stderr: 'EAS error: invalid token'
            });
            mockExecFileError(err);

            const target = new EasTarget('production');

            await expect(target.list()).rejects.toThrow('EAS CLI failed: EAS error: invalid token');
        });

        it('redacts --value arg from error message in set()', async () => {
            const err = Object.assign(new Error('Command failed'), {
                stderr: 'Error setting value'
            });
            mockExecFileError(err);

            const target = new EasTarget('production');

            // The error message should not contain the secret value
            await expect(target.set('API_KEY', 'my-super-secret', true)).rejects.toThrow(
                expect.not.objectContaining({ message: expect.stringContaining('my-super-secret') })
            );
        });
    });
});
