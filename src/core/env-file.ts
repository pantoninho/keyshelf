/**
 * Parse a KEY=VALUE env file into a flat record.
 *
 * Ignores blank lines and comments. Strips surrounding quotes from values.
 *
 * @param content - Raw file content
 * @returns Record of key to string value
 */
export function parseEnvFile(content: string): Record<string, string> {
    const result: Record<string, string> = {};

    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;

        const key = trimmed.slice(0, eqIndex).trim();
        let value = trimmed.slice(eqIndex + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        result[key] = value;
    }

    return result;
}
