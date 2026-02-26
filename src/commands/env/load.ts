import { Args, Command, Flags } from '@oclif/core';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { loadEnvironment, saveEnvironment } from '../../core/environment.js';
import { loadConfig } from '../../core/config.js';
import { PathTree } from '../../core/path-tree.js';
import { SecretRef } from '../../core/types.js';
import { createProvider } from '../../providers/index.js';

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
        const entries = parseEnvFile(content);

        const def = await loadEnvironment(cwd, args.env);
        const tree = PathTree.fromJSON(def.values);

        let provider = null;
        if (flags.secrets) {
            const config = loadConfig(cwd);
            const configDir =
                flags['config-dir'] ?? path.join(os.homedir(), '.config', 'keyshelf', config.name);
            provider = createProvider(config.provider, configDir);
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

        await saveEnvironment(cwd, args.env, { imports: def.imports, values: tree.toJSON() });
        this.log(`Loaded ${entries.length} entries into "${args.env}"`);
    }
}

function parseEnvFile(content: string): [string, string][] {
    const entries: [string, string][] = [];

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

        entries.push([key, value]);
    }

    return entries;
}
