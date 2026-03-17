import { Command, Flags } from '@oclif/core';
import { spawnSync } from 'node:child_process';
import { resolveEnv } from '../core/resolve-env.js';
import { loadEnvMapping } from '../core/env-keyshelf.js';

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

        const projectDir = process.cwd();
        const envMapping = loadEnvMapping(projectDir);
        if (Object.keys(envMapping).length === 0) {
            this.warn('No .env.keyshelf file found — no environment variables will be injected.');
        }
        const envRecord = await resolveEnv({
            env: flags.env,
            projectDir,
            configDir: flags['config-dir'],
            envMapping
        });

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
