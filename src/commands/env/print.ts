import { Args, Command, Flags } from '@oclif/core';
import path from 'node:path';
import os from 'node:os';
import yamlLib from 'js-yaml';
import { loadEnvironment } from '../../core/environment.js';
import { loadConfig } from '../../core/config.js';
import { resolve } from '../../core/resolver.js';
import { replaceSecrets, flattenToEnvRecord } from '../../core/env-vars.js';
import { SecretRef } from '../../core/types.js';
import { SecretProvider } from '../../providers/provider.js';
import { resolveProvider } from '../../providers/index.js';

export default class EnvPrint extends Command {
    static override description = 'Print resolved environment config';

    static override examples = [
        '<%= config.bin %> env:print dev',
        '<%= config.bin %> env:print dev --reveal',
        '<%= config.bin %> env:print dev --format json',
        '<%= config.bin %> env:print dev --format env'
    ];

    static override args = {
        env: Args.string({ description: 'Environment name', required: true })
    };

    static override flags = {
        reveal: Flags.boolean({ description: 'Show actual secret values', default: false }),
        format: Flags.string({
            description: 'Output format',
            options: ['yaml', 'json', 'env'],
            default: 'yaml'
        }),
        'config-dir': Flags.string({ description: 'Override config directory', hidden: true })
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(EnvPrint);
        const cwd = process.cwd();

        const envDef = await loadEnvironment(cwd, args.env);
        const resolved = await resolve(args.env, (name) => loadEnvironment(cwd, name));
        const config = loadConfig(cwd);
        const configDirPath =
            flags['config-dir'] ?? path.join(os.homedir(), '.config', 'keyshelf', config.name);
        const provider = resolveProvider(envDef, config, configDirPath);

        if (flags.format === 'json' && !flags.reveal) {
            const split = {
                config: flattenConfig(resolved.values),
                secrets: extractSecretRefs(resolved.values, args.env, provider)
            };
            this.log(JSON.stringify(split, null, 2));
            return;
        }

        const output = await replaceSecrets(
            resolved.values,
            args.env,
            provider,
            flags.reveal ? 'reveal' : 'ref'
        );

        switch (flags.format) {
            case 'json':
                this.log(JSON.stringify(output, null, 2));
                break;
            case 'env':
                if (envDef.env) {
                    const envRecord = flattenToEnvRecord(output, envDef.env);
                    for (const [k, v] of Object.entries(envRecord)) {
                        this.log(`${k}=${v}`);
                    }
                } else {
                    for (const line of flattenToEnv(output)) {
                        this.log(line);
                    }
                }
                break;
            default:
                this.log(yamlLib.dump(output).trimEnd());
        }
    }
}

function flattenConfig(values: Record<string, unknown>, prefix = ''): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(values)) {
        const fullPath = prefix ? `${prefix}/${key}` : key;
        if (value instanceof SecretRef) {
            continue;
        } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            Object.assign(result, flattenConfig(value as Record<string, unknown>, fullPath));
        } else {
            result[fullPath] = value;
        }
    }

    return result;
}

function extractSecretRefs(
    values: Record<string, unknown>,
    env: string,
    provider: SecretProvider,
    prefix = ''
): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(values)) {
        const fullPath = prefix ? `${prefix}/${key}` : key;
        if (value instanceof SecretRef) {
            result[fullPath] = provider.ref(env, value.path);
        } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            Object.assign(
                result,
                extractSecretRefs(value as Record<string, unknown>, env, provider, fullPath)
            );
        }
    }

    return result;
}

function flattenToEnv(obj: Record<string, unknown>, prefix = ''): string[] {
    const lines: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
        const envKey = prefix ? `${prefix}_${key}` : key;
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            lines.push(...flattenToEnv(value as Record<string, unknown>, envKey));
        } else {
            lines.push(`${envKey.toUpperCase()}=${value}`);
        }
    }
    return lines;
}
