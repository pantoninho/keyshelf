import { Args, Command, Flags } from '@oclif/core';
import path from 'node:path';
import os from 'node:os';
import { loadEnvironment, saveEnvironment } from '../../core/environment.js';
import { loadConfig } from '../../core/config.js';
import { PathTree } from '../../core/path-tree.js';
import { SecretRef } from '../../core/types.js';
import { LocalProvider } from '../../providers/local.js';

export default class SecretRm extends Command {
    static override description = 'Remove a secret from an environment';

    static override examples = ['<%= config.bin %> secret:rm dev database/password'];

    static override args = {
        env: Args.string({ description: 'Environment name', required: true }),
        path: Args.string({ description: 'Secret path to remove', required: true })
    };

    static override flags = {
        'config-dir': Flags.string({ description: 'Override config directory', hidden: true })
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(SecretRm);
        const cwd = process.cwd();

        const def = await loadEnvironment(cwd, args.env);
        const tree = PathTree.fromJSON(def.values);
        const value = tree.get(args.path);

        if (!(value instanceof SecretRef)) {
            this.error(
                `Secret "${args.path}" not found in environment "${args.env}". Use "keyshelf secret:list ${args.env}" to see available secrets.`
            );
        }

        const config = loadConfig(cwd);
        const configDir =
            flags['config-dir'] ?? path.join(os.homedir(), '.config', 'keyshelf', config.name);
        const provider = new LocalProvider(configDir);
        await provider.delete(args.env, value.path);

        tree.delete(args.path);
        await saveEnvironment(cwd, args.env, { imports: def.imports, values: tree.toJSON() });

        this.log(`Removed secret ${args.path}`);
    }
}
