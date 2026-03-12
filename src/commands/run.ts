import { Command, Flags } from '@oclif/core';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { loadEnvironment } from '../core/environment.js';
import { loadConfig } from '../core/config.js';
import { resolve } from '../core/resolver.js';
import { replaceSecrets, flattenToEnvRecord } from '../core/env-vars.js';
import { resolveProvider } from '../providers/index.js';

export default class Run extends Command {
    static override description =
        'Run a command with resolved environment config and secrets as env vars';

    static override examples = [
        '<%= config.bin %> run --env prod -- node server.js',
        '<%= config.bin %> run --env dev -- docker compose up'
    ];

    static override strict = false;

    static override flags = {
        env: Flags.string({ description: 'Environment name', required: true }),
        'config-dir': Flags.string({ description: 'Override config directory', hidden: true })
    };

    async run(): Promise<void> {
        const { argv, flags } = await this.parse(Run);
        const command = argv as string[];

        if (command.length === 0) {
            this.error('No command specified. Provide a command after "--".');
        }

        const cwd = process.cwd();
        const envDef = await loadEnvironment(cwd, flags.env);
        const resolved = await resolve(flags.env, (name) => loadEnvironment(cwd, name));
        const config = loadConfig(cwd);
        const configDirPath =
            flags['config-dir'] ?? path.join(os.homedir(), '.config', 'keyshelf', config.name);
        const provider = resolveProvider(envDef, config, configDirPath);

        const replaced = await replaceSecrets(resolved.values, flags.env, provider, 'reveal');
        const envRecord = flattenToEnvRecord(replaced);

        const [cmd, ...args] = command;
        const result = spawnSync(cmd, args, {
            stdio: 'inherit',
            env: { ...process.env, ...envRecord }
        });

        if (result.error) {
            this.error(`Failed to run command: ${result.error.message}`);
        }

        this.exit(result.status ?? 1);
    }
}
