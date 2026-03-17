import fs from 'node:fs';
import path from 'node:path';
import { parseEnvFile } from './env-file.js';

export const ENV_KEYSHELF_FILENAME = '.env.keyshelf';

/**
 * Load env var mappings from a .env.keyshelf file in the project root.
 * Returns an empty record if the file does not exist.
 *
 * @param projectDir - Path to the project root directory
 * @returns Record mapping env var names to slash-delimited value paths
 */
export function loadEnvMapping(projectDir: string): Record<string, string> {
    const filePath = path.join(projectDir, ENV_KEYSHELF_FILENAME);
    if (!fs.existsSync(filePath)) {
        return {};
    }
    return parseEnvFile(fs.readFileSync(filePath, 'utf-8'));
}
