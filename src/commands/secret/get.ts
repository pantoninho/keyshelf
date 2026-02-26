import { Args, Command, Flags } from '@oclif/core';
import path from 'node:path';
import os from 'node:os';
import { loadEnvironment } from '../../core/environment.js';
import { loadConfig } from '../../core/config.js';
import { resolve } from '../../core/resolver.js';
import { PathTree } from '../../core/path-tree.js';
import { SecretRef } from '../../core/types.js';
import { LocalProvider } from '../../providers/local.js';

export default class SecretGet extends Command {
    static override description = 'Get a secret value from an environment';

    static override examples = ['<%= config.bin %> secret:get dev database/password'];

    static override args = {
        env: Args.string({ description: 'Environment name', required: true }),
        path: Args.string({ description: 'Secret path (slash-delimited)', required: true })
    };

    static override flags = {
        'config-dir': Flags.string({ description: 'Override config directory', hidden: true })
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(SecretGet);
        const cwd = process.cwd();

        const resolved = await resolve(args.env, (name) => loadEnvironment(cwd, name));
        const tree = PathTree.fromJSON(resolved.values);
        const value = tree.get(args.path);

        if (!(value instanceof SecretRef)) {
            this.error(`Secret "${args.path}" not found in environment "${args.env}"`);
        }

        const config = loadConfig(cwd);
        const configDir =
            flags['config-dir'] ?? path.join(os.homedir(), '.config', 'keyshelf', config.name);
        const provider = new LocalProvider(configDir);
        const secret = await provider.get(args.env, value.path);
        this.log(secret);
    }
}
