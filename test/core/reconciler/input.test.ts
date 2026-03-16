import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeCollector, readMaskedLine } from '../../../src/core/reconciler/input.js';

describe('readMaskedLine', () => {
    it('resolves correctly when a multi-character chunk with newline is delivered at once', async () => {
        const mockStdin = {
            setRawMode: vi.fn(),
            on: vi.fn(),
            removeListener: vi.fn(),
            resume: vi.fn(),
            pause: vi.fn()
        };
        const mockStdout = { write: vi.fn() };

        const originalStdin = process.stdin;
        const originalStdout = process.stdout;
        Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true });
        Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true });

        let capturedHandler: ((chunk: Buffer) => void) | undefined;
        mockStdin.on.mockImplementation((_event: string, handler: (chunk: Buffer) => void) => {
            capturedHandler = handler;
        });

        const resultPromise = readMaskedLine('Enter secret: ');

        // Simulate a multi-character chunk delivered at once (e.g. pasted input)
        capturedHandler!(Buffer.from('secret\n'));

        const result = await resultPromise;
        expect(result).toBe('secret');

        Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
        Object.defineProperty(process, 'stdout', { value: originalStdout, configurable: true });
    });
});

describe('makeCollector', () => {
    describe('env source', () => {
        const originalEnv = process.env;

        beforeEach(() => {
            process.env = { ...originalEnv };
        });

        afterEach(() => {
            process.env = originalEnv;
        });

        it('returns value from process.env for mapped path', async () => {
            process.env.DATABASE_URL = 'postgres://localhost/test';
            const collect = makeCollector({
                kind: 'env',
                mapping: { DATABASE_URL: 'database/url' }
            });

            const value = await collect('database/url');
            expect(value).toBe('postgres://localhost/test');
        });

        it('throws when path has no mapping', async () => {
            const collect = makeCollector({ kind: 'env', mapping: {} });

            await expect(collect('unmapped/path')).rejects.toThrow(/unmapped\/path/);
        });

        it('throws when env var is not set', async () => {
            delete process.env.DATABASE_URL;
            const collect = makeCollector({
                kind: 'env',
                mapping: { DATABASE_URL: 'database/url' }
            });

            await expect(collect('database/url')).rejects.toThrow(/DATABASE_URL/);
        });
    });

    describe('file source', () => {
        it('returns value from file values for matching path', async () => {
            const collect = makeCollector({
                kind: 'file',
                values: { 'db/password': 'secret123' }
            });

            const value = await collect('db/password');
            expect(value).toBe('secret123');
        });

        it('throws when path is not in file', async () => {
            const collect = makeCollector({ kind: 'file', values: {} });

            await expect(collect('missing/path')).rejects.toThrow(/missing\/path/);
        });
    });
});
