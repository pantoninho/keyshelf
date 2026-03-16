type ValueSource =
    | { kind: 'prompt' }
    | { kind: 'env'; mapping: Record<string, string> }
    | { kind: 'file'; values: Record<string, string> };

/**
 * Create a value collector function for the given source.
 *
 * - 'prompt': reads from stdin with masked input
 * - 'env': reverse-looks up the path in the mapping to find a var name, then reads process.env
 * - 'file': direct lookup by path in the provided values record
 *
 * @param source - The value source configuration
 * @returns Async function that returns the value for a given secret path
 */
export function makeCollector(source: ValueSource): (path: string) => Promise<string> {
    switch (source.kind) {
        case 'prompt':
            return promptCollector;
        case 'env':
            return makeEnvCollector(source.mapping);
        case 'file':
            return makeFileCollector(source.values);
    }
}

async function promptCollector(path: string): Promise<string> {
    return readMaskedLine(`Enter value for "${path}": `);
}

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

function makeEnvCollector(mapping: Record<string, string>): (path: string) => Promise<string> {
    const reverseMapping = buildReverseMapping(mapping);
    return async (path: string) => {
        const varName = reverseMapping.get(path);
        if (!varName) {
            throw new Error(
                `No env var mapped to secret path "${path}". Add it to the env section.`
            );
        }
        const value = process.env[varName];
        if (value === undefined) {
            throw new Error(
                `Environment variable "${varName}" is not set. It is required for secret "${path}".`
            );
        }
        return value;
    };
}

function buildReverseMapping(mapping: Record<string, string>): Map<string, string> {
    const reverse = new Map<string, string>();
    for (const [varName, path] of Object.entries(mapping)) {
        reverse.set(path, varName);
    }
    return reverse;
}

function makeFileCollector(values: Record<string, string>): (path: string) => Promise<string> {
    return async (path: string) => {
        const value = values[path];
        if (value === undefined) {
            throw new Error(
                `Secret path "${path}" not found in the provided file. Check that the file contains this key.`
            );
        }
        return value;
    };
}
