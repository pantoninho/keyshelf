import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { KeyshelfConfig } from './types.js';

const KNOWN_ADAPTERS = ['local'];

/** Load and validate keyshelf.yml from a project root directory. */
export function loadConfig(projectRoot: string): KeyshelfConfig {
    const configPath = path.join(projectRoot, 'keyshelf.yml');

    let content: string;
    try {
        content = fs.readFileSync(configPath, 'utf-8');
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error(
                `keyshelf.yml not found in ${projectRoot}. Run "keyshelf init" to create one.`
            );
        }
        throw err;
    }

    let raw: unknown;
    try {
        raw = yaml.load(content);
    } catch {
        throw new Error(`Failed to parse keyshelf.yml: invalid YAML syntax.`);
    }

    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error('Failed to parse keyshelf.yml: expected a YAML mapping.');
    }

    const obj = raw as Record<string, unknown>;

    if (!obj.name || typeof obj.name !== 'string') {
        throw new Error('Invalid keyshelf.yml: missing required field "name".');
    }

    if (!obj.provider || typeof obj.provider !== 'object' || Array.isArray(obj.provider)) {
        throw new Error('Invalid keyshelf.yml: missing required field "provider".');
    }

    const provider = obj.provider as Record<string, unknown>;

    if (!provider.adapter || typeof provider.adapter !== 'string') {
        throw new Error('Invalid keyshelf.yml: missing required field "provider.adapter".');
    }

    if (!KNOWN_ADAPTERS.includes(provider.adapter)) {
        throw new Error(
            `Invalid keyshelf.yml: unknown adapter "${provider.adapter}". Available adapters: ${KNOWN_ADAPTERS.join(', ')}.`
        );
    }

    return { name: obj.name, provider: { adapter: provider.adapter } };
}
