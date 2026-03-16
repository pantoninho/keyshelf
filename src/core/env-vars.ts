import { SecretRef } from './types.js';
import { SecretProvider } from '../providers/provider.js';

/** Recursively walk values, resolving SecretRef via provider. */
export async function replaceSecrets(
    values: Record<string, unknown>,
    env: string,
    provider: SecretProvider,
    mode: 'reveal' | 'ref'
): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(values)) {
        if (value instanceof SecretRef) {
            result[key] =
                mode === 'reveal'
                    ? await provider.get(env, value.path)
                    : provider.ref(env, value.path);
        } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            result[key] = await replaceSecrets(
                value as Record<string, unknown>,
                env,
                provider,
                mode
            );
        } else {
            result[key] = value;
        }
    }

    return result;
}

/**
 * Walk a slash-delimited path in a nested object.
 *
 * @param obj - The object to walk
 * @param path - Slash-delimited path string
 * @returns The value at the path, or undefined if not found
 */
export function lookupPath(obj: Record<string, unknown>, path: string): unknown {
    const segments = path.split('/');
    let current: unknown = obj;

    for (const segment of segments) {
        if (current === null || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[segment];
    }

    return current;
}

/**
 * Flatten a nested object to a flat Record<string, string>.
 *
 * When envMapping is provided, only the mapped variables are returned,
 * with values resolved by path from the object. When absent, all keys
 * are uppercased and underscore-separated.
 *
 * @param obj - The nested object to flatten
 * @param envMapping - Optional mapping of env var name to slash-delimited path
 */
export function flattenToEnvRecord(
    obj: Record<string, unknown>,
    envMapping?: Record<string, string>
): Record<string, string> {
    if (envMapping) {
        return flattenWithMapping(obj, envMapping);
    }
    return flattenGeneric(obj);
}

function flattenWithMapping(
    obj: Record<string, unknown>,
    envMapping: Record<string, string>
): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [varName, path] of Object.entries(envMapping)) {
        const value = lookupPath(obj, path);
        result[varName] = String(value);
    }
    return result;
}

function flattenGeneric(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(obj)) {
        const envKey = prefix ? `${prefix}_${key}` : key;
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            Object.assign(result, flattenGeneric(value as Record<string, unknown>, envKey));
        } else {
            result[envKey.toUpperCase()] = String(value);
        }
    }

    return result;
}
