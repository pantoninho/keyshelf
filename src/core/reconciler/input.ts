import { readMaskedLine } from '../input.js';

export { readMaskedLine };

type ValueSource = { kind: 'prompt' } | { kind: 'file'; values: Record<string, string> };

/**
 * Create a value collector function for the given source.
 *
 * - 'prompt': reads from stdin with masked input
 * - 'file': direct lookup by path in the provided values record
 *
 * @param source - The value source configuration
 * @returns Async function that returns the value for a given secret path
 */
export function makeCollector(source: ValueSource): (path: string) => Promise<string> {
    switch (source.kind) {
        case 'prompt':
            return promptCollector;
        case 'file':
            return makeFileCollector(source.values);
    }
}

async function promptCollector(path: string): Promise<string> {
    return readMaskedLine(`Enter value for "${path}": `);
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
