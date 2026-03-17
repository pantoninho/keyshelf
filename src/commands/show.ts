import { Command, Flags } from '@oclif/core';
import yamlLib from 'js-yaml';
import { loadEnvironment } from '../core/environment.js';
import { loadConfig, defaultConfigDir, findProjectRoot } from '../core/config.js';
import { resolve } from '../core/resolver.js';
import { replaceSecrets, flattenToEnvRecord } from '../core/env-vars.js';
import { SecretRef } from '../core/types.js';
import { resolveProvider } from '../providers/index.js';
import { loadEnvMapping } from '../core/env-keyshelf.js';
import { PathTree } from '../core/path-tree.js';

export default class Show extends Command {
    static override description = 'Show resolved environment config';

    static override examples = [
        '<%= config.bin %> show --env dev',
        '<%= config.bin %> show --env dev --reveal',
        '<%= config.bin %> show --env dev --format json',
        '<%= config.bin %> show --env dev --format env',
        '<%= config.bin %> show --env dev --paths'
    ];

    static override flags = {
        env: Flags.string({ description: 'Environment name', required: true }),
        reveal: Flags.boolean({ description: 'Show actual secret values', default: false }),
        format: Flags.string({
            description: 'Output format',
            options: ['yaml', 'json', 'env'],
            default: 'yaml'
        }),
        paths: Flags.boolean({
            description: 'List leaf paths with (secret) suffix',
            default: false
        }),
        'config-dir': Flags.string({ description: 'Override config directory', hidden: true })
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(Show);

        if (flags.paths && (flags.reveal || flags.format !== 'yaml')) {
            this.error('--paths cannot be combined with --format or --reveal');
        }

        const projectRoot = findProjectRoot(process.cwd());
        if (!projectRoot) {
            this.error('keyshelf.yml not found in current directory or any parent directory.');
        }

        const resolved = await resolve(flags.env, (name) => loadEnvironment(projectRoot, name));

        if (flags.paths) {
            this.runPathsMode(resolved.values);
            return;
        }

        if (!flags.reveal && flags.format !== 'env') {
            this.renderOutput(flags.format, maskSecrets(resolved.values));
            return;
        }

        const envDef = await loadEnvironment(projectRoot, flags.env);
        const config = loadConfig(projectRoot);
        const configDirPath = flags['config-dir'] ?? defaultConfigDir(config);
        const provider = resolveProvider(envDef, config, configDirPath);

        if (flags.format === 'env') {
            const mode = flags.reveal ? 'reveal' : 'ref';
            const output = await replaceSecrets(resolved.values, flags.env, provider, mode);
            this.runEnvFormat(output);
            return;
        }

        const output = await replaceSecrets(resolved.values, flags.env, provider, 'reveal');
        this.renderOutput(flags.format, output);
    }

    private runPathsMode(values: Record<string, unknown>): void {
        const tree = PathTree.fromJSON(values);
        const paths = tree.list();
        for (const p of paths) {
            const value = tree.get(p);
            const suffix = value instanceof SecretRef ? ' (secret)' : '';
            this.log(`${p}${suffix}`);
        }
    }

    private runEnvFormat(output: Record<string, unknown>): void {
        const envMapping = loadEnvMapping(process.cwd());
        if (Object.keys(envMapping).length === 0) {
            this.warn('No .env.keyshelf file found — no environment variables will be injected.');
        }
        const record = flattenToEnvRecord(output, envMapping);
        for (const [key, value] of Object.entries(record)) {
            this.log(`${key}=${value}`);
        }
    }

    private renderOutput(format: string, output: Record<string, unknown>): void {
        if (format === 'json') {
            this.log(JSON.stringify(output, null, 2));
        } else {
            this.log(yamlLib.dump(output).trimEnd());
        }
    }
}

/** Recursively replace all SecretRef values with the literal string '<secret>'. */
function maskSecrets(values: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
        if (value instanceof SecretRef) {
            result[key] = '<secret>';
        } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            result[key] = maskSecrets(value as Record<string, unknown>);
        } else {
            result[key] = value;
        }
    }
    return result;
}
