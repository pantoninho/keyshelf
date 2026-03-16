import { Args, Command, Flags } from '@oclif/core';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { loadEnvironment, saveEnvironment } from '../../core/environment.js';
import { loadConfig } from '../../core/config.js';
import { PathTree } from '../../core/path-tree.js';
import { SecretRef } from '../../core/types.js';
import { resolveProvider } from '../../providers/index.js';
import { parseEnvFile } from '../../core/env-file.js';

export default class EnvLoad extends Command {
    static override description = 'Load KEY=VALUE pairs from a file into an environment';

    static override examples = [
        '<%= config.bin %> env:load dev .env',
        '<%= config.bin %> env:load dev .env --prefix database',
        '<%= config.bin %> env:load dev .env.secrets --secrets'
    ];

    static override args = {
        env: Args.string({ description: 'Environment name', required: true }),
        file: Args.string({ description: 'Path to env file', required: true })
    };

    static override flags = {
        prefix: Flags.string({ description: 'Nest all values under this path' }),
        secrets: Flags.boolean({
            description: 'Treat all values as secrets',
            default: false
        }),
        'config-dir': Flags.string({ description: 'Override config directory', hidden: true })
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(EnvLoad);
        const cwd = process.cwd();

        if (!fs.existsSync(args.file)) {
            this.error(`File not found: ${args.file}`);
        }

        const content = fs.readFileSync(args.file, 'utf-8');
        const fileValues = parseEnvFile(content);
        const entries = Object.entries(fileValues);

        const def = await loadEnvironment(cwd, args.env);
        const tree = PathTree.fromJSON(def.values);

        let provider = null;
        if (flags.secrets) {
            const config = loadConfig(cwd);
            const configDir =
                flags['config-dir'] ?? path.join(os.homedir(), '.config', 'keyshelf', config.name);
            provider = resolveProvider(def, config, configDir);
        }

        for (const [key, value] of entries) {
            const fullPath = flags.prefix ? `${flags.prefix}/${key}` : key;

            if (provider) {
                await provider.set(args.env, fullPath, value);
                tree.set(fullPath, new SecretRef(fullPath));
            } else {
                tree.set(fullPath, value);
            }
        }

        await saveEnvironment(cwd, args.env, { ...def, values: tree.toJSON() });
        this.log(`Loaded ${entries.length} entries into "${args.env}"`);
    }
}
