import { readMaskedLine } from '../input.js';

export { readMaskedLine };

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
