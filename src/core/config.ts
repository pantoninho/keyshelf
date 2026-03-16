import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import { KeyshelfConfig, ProviderConfig } from './types.js';

const KNOWN_ADAPTERS = ['local', 'gcp-sm', 'aws-sm'];

/** Parse and validate a raw provider object into a ProviderConfig. */
export function parseProviderConfig(
    provider: Record<string, unknown>,
    context: string
): ProviderConfig {
    if (!provider.adapter || typeof provider.adapter !== 'string') {
        throw new Error(`Invalid ${context}: missing required field "provider.adapter".`);
    }

    if (!KNOWN_ADAPTERS.includes(provider.adapter)) {
        throw new Error(
            `Invalid ${context}: unknown adapter "${provider.adapter}". Available adapters: ${KNOWN_ADAPTERS.join(', ')}.`
        );
    }

    switch (provider.adapter) {
        case 'local':
            return { adapter: 'local' };
        case 'gcp-sm':
            if (!provider.project || typeof provider.project !== 'string') {
                throw new Error(
                    `Invalid ${context}: "gcp-sm" adapter requires field "provider.project".`
                );
            }
            return { adapter: 'gcp-sm', project: provider.project };
        case 'aws-sm': {
            if (provider.profile !== undefined && typeof provider.profile !== 'string') {
                throw new Error(
                    `Invalid ${context}: "aws-sm" field "provider.profile" must be a string.`
                );
            }
            const awsConfig: { adapter: 'aws-sm'; profile?: string } = { adapter: 'aws-sm' };
            if (provider.profile !== undefined) awsConfig.profile = provider.profile as string;
            return awsConfig;
        }
        default:
            throw new Error('unreachable');
    }
}

/**
 * Return the default config directory for a keyshelf project.
 *
 * @param config - Loaded keyshelf config
 * @returns Absolute path to the default config directory
 */
export function defaultConfigDir(config: KeyshelfConfig): string {
    return path.join(os.homedir(), '.config', 'keyshelf', config.name);
}

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
    const providerConfig = parseProviderConfig(provider, 'keyshelf.yml');

    return { name: obj.name, provider: providerConfig };
}
