/**
 * Read a line from stdin with masked output (each character shown as '*').
 * Handles multi-character chunks by processing characters one-by-one.
 *
 * @param prompt - Text to display before the input
 * @returns The entered string (without the trailing newline)
 */
export function readMaskedLine(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
        process.stdout.write(prompt);
        process.stdin.setRawMode?.(true);
        process.stdin.resume();

        let value = '';

        function onData(chunk: Buffer): void {
            for (const char of chunk.toString()) {
                if (char === '\r' || char === '\n') {
                    process.stdin.setRawMode?.(false);
                    process.stdin.removeListener('data', onData);
                    process.stdin.pause();
                    process.stdout.write('\n');
                    resolve(value);
                    return;
                }
                if (char === '\u0003') {
                    process.stdin.setRawMode?.(false);
                    process.stdin.removeListener('data', onData);
                    process.stdin.pause();
                    reject(new Error('Aborted by user'));
                    return;
                }
                value += char;
                process.stdout.write('*');
            }
        }

        process.stdin.on('data', onData);
    });
}
