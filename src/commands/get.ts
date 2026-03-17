import { Args, Command, Flags } from '@oclif/core';
import { loadEnvironment } from '../core/environment.js';
import { loadConfig, defaultConfigDir } from '../core/config.js';
import { resolve } from '../core/resolver.js';
import { PathTree } from '../core/path-tree.js';
import { SecretRef } from '../core/types.js';
import { resolveProvider } from '../providers/index.js';

export default class Get extends Command {
    static override description = 'Get a value from an environment';

    static override examples = ['<%= config.bin %> get --env dev database/password'];

    static override args = {
        path: Args.string({ description: 'Path (slash-delimited)', required: true })
    };

    static override flags = {
        env: Flags.string({ description: 'Environment name', required: true }),
        'config-dir': Flags.string({ description: 'Override config directory', hidden: true })
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Get);
        const cwd = process.cwd();

        const resolved = await resolve(flags.env, (name) => loadEnvironment(cwd, name));
        const tree = PathTree.fromJSON(resolved.values);
        const value = tree.get(args.path);

        if (value === undefined) {
            this.error(
                `Path "${args.path}" not found in environment "${flags.env}". Run "keyshelf list --env ${flags.env}" to see available paths.`
            );
        }

        if (typeof value === 'object' && value !== null && !(value instanceof SecretRef)) {
            this.error(`Path "${args.path}" is not a leaf value.`);
        }

        if (value instanceof SecretRef) {
            const envDef = await loadEnvironment(cwd, flags.env);
            const config = loadConfig(cwd);
            const configDir = flags['config-dir'] ?? defaultConfigDir(config);
            const provider = resolveProvider(envDef, config, configDir);
            const secret = await provider.get(flags.env, value.path);
            this.log(secret);
            return;
        }

        this.log(String(value));
    }
}
