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

/** Flatten a nested object to a flat Record<string, string> with uppercased, underscore-separated keys. */
export function flattenToEnvRecord(
    obj: Record<string, unknown>,
    prefix = ''
): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(obj)) {
        const envKey = prefix ? `${prefix}_${key}` : key;
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            Object.assign(result, flattenToEnvRecord(value as Record<string, unknown>, envKey));
        } else {
            result[envKey.toUpperCase()] = String(value);
        }
    }

    return result;
}
