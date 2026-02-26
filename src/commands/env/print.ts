import { Args, Command, Flags } from '@oclif/core';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import yamlLib from 'js-yaml';
import { loadEnvironment } from '../../core/environment.js';
import { resolve } from '../../core/resolver.js';
import { PathTree } from '../../core/path-tree.js';
import { SecretRef, KeyshelfConfig } from '../../core/types.js';
import { LocalProvider } from '../../providers/local.js';

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

        const resolved = await resolve(args.env, (name) => loadEnvironment(cwd, name));
        const configDirPath = flags['config-dir'] ?? defaultConfigDir(cwd);
        const output = await replaceSecrets(
            resolved.values,
            args.env,
            configDirPath,
            flags.reveal
        );

        switch (flags.format) {
            case 'json':
                this.log(JSON.stringify(output, null, 2));
                break;
            case 'env':
                for (const line of flattenToEnv(output)) {
                    this.log(line);
                }
                break;
            default:
                this.log(yamlLib.dump(output).trimEnd());
        }
    }
}

async function replaceSecrets(
    values: Record<string, unknown>,
    env: string,
    configDir: string,
    reveal: boolean
): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    const provider = new LocalProvider(configDir);

    for (const [key, value] of Object.entries(values)) {
        if (value instanceof SecretRef) {
            if (reveal) {
                result[key] = await provider.get(env, value.path);
            } else {
                result[key] = '********';
            }
        } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            result[key] = await replaceSecrets(
                value as Record<string, unknown>,
                env,
                configDir,
                reveal
            );
        } else {
            result[key] = value;
        }
    }

    return result;
}

function flattenToEnv(
    obj: Record<string, unknown>,
    prefix = ''
): string[] {
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

function defaultConfigDir(cwd: string): string {
    const configPath = path.join(cwd, 'keyshelf.yml');
    const config = yamlLib.load(fs.readFileSync(configPath, 'utf-8')) as KeyshelfConfig;
    return path.join(os.homedir(), '.config', 'keyshelf', config.name);
}
