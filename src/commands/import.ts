import { Args, Command, Flags } from '@oclif/core';
import fs from 'node:fs';
import { loadEnvironment, saveEnvironment } from '../core/environment.js';
import { loadConfig, defaultConfigDir, findProjectRoot } from '../core/config.js';
import { PathTree } from '../core/path-tree.js';
import { SecretRef } from '../core/types.js';
import { resolveProvider } from '../providers/index.js';
import { parseEnvFile } from '../core/env-file.js';

export default class Import extends Command {
    static override description = 'Import KEY=VALUE pairs from a file into an environment';

    static override examples = [
        '<%= config.bin %> import --env dev .env',
        '<%= config.bin %> import --env dev .env --prefix database',
        '<%= config.bin %> import --env dev .env.secrets --secrets'
    ];

    static override args = {
        file: Args.string({ description: 'Path to env file', required: true })
    };

    static override flags = {
        env: Flags.string({ description: 'Environment name', required: true }),
        prefix: Flags.string({ description: 'Nest all values under this path' }),
        secrets: Flags.boolean({
            description: 'Treat all values as secrets',
            default: false
        }),
        'config-dir': Flags.string({ description: 'Override config directory', hidden: true })
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Import);
        const projectRoot = findProjectRoot(process.cwd());
        if (!projectRoot) {
            this.error('keyshelf.yml not found in current directory or any parent directory.');
        }

        if (!fs.existsSync(args.file)) {
            this.error(`File not found: ${args.file}`);
        }

        const content = fs.readFileSync(args.file, 'utf-8');
        const fileValues = parseEnvFile(content);
        const entries = Object.entries(fileValues);

        const def = await loadEnvironment(projectRoot, flags.env);
        const tree = PathTree.fromJSON(def.values);

        let provider = null;
        if (flags.secrets) {
            const config = loadConfig(projectRoot);
            const configDir =
                flags['config-dir'] ?? defaultConfigDir(config);
            provider = resolveProvider(def, config, configDir);
        }

        for (const [key, value] of entries) {
            const fullPath = flags.prefix ? `${flags.prefix}/${key}` : key;

            if (provider) {
                await provider.set(flags.env, fullPath, value);
                tree.set(fullPath, new SecretRef(fullPath));
            } else {
                tree.set(fullPath, value);
            }
        }

        await saveEnvironment(projectRoot, flags.env, { ...def, values: tree.toJSON() });
        this.log(`Loaded ${entries.length} entries into "${flags.env}"`);
    }
}
