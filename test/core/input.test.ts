import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readMaskedLine } from '../../src/core/input.js';

function setupMockIO() {
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

    return {
        mockStdin,
        mockStdout,
        getHandler: () => capturedHandler!,
        restore() {
            Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
            Object.defineProperty(process, 'stdout', {
                value: originalStdout,
                configurable: true
            });
        }
    };
}

describe('readMaskedLine', () => {
    let io: ReturnType<typeof setupMockIO>;

    beforeEach(() => {
        io = setupMockIO();
    });

    afterEach(() => {
        io.restore();
        vi.restoreAllMocks();
    });

    it('resolves with typed value on newline', async () => {
        const resultPromise = readMaskedLine('Password: ');
        io.getHandler()(Buffer.from('hello\n'));
        expect(await resultPromise).toBe('hello');
    });

    it('writes a * for each typed character', async () => {
        const resultPromise = readMaskedLine('Password: ');
        io.getHandler()(Buffer.from('abc\n'));
        await resultPromise;
        const writes = (io.mockStdout.write as ReturnType<typeof vi.fn>).mock.calls.map(
            (c) => c[0]
        );
        expect(writes.filter((w) => w === '*')).toHaveLength(3);
    });

    it('backspace (DEL \\u007f) removes the last character', async () => {
        const resultPromise = readMaskedLine('Password: ');
        io.getHandler()(Buffer.from('ab\u007fc\n'));
        expect(await resultPromise).toBe('ac');
    });

    it('backspace (\\b) removes the last character', async () => {
        const resultPromise = readMaskedLine('Password: ');
        io.getHandler()(Buffer.from('ab\bc\n'));
        expect(await resultPromise).toBe('ac');
    });

    it('backspace at empty input does not corrupt value', async () => {
        const resultPromise = readMaskedLine('Password: ');
        io.getHandler()(Buffer.from('\u007fab\n'));
        expect(await resultPromise).toBe('ab');
    });

    it('backspace writes \\b \\b to stdout to erase the asterisk', async () => {
        const resultPromise = readMaskedLine('Password: ');
        io.getHandler()(Buffer.from('a\u007f\n'));
        await resultPromise;
        const writes = (io.mockStdout.write as ReturnType<typeof vi.fn>).mock.calls.map(
            (c) => c[0]
        );
        expect(writes).toContain('\b \b');
    });

    it('rejects with abort error on Ctrl-C', async () => {
        const resultPromise = readMaskedLine('Password: ');
        io.getHandler()(Buffer.from('\u0003'));
        await expect(resultPromise).rejects.toThrow(/Aborted/);
    });
});
