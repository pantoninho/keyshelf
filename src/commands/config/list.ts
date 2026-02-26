import { Args, Command, Flags } from '@oclif/core';
import { loadEnvironment } from '../../core/environment.js';
import { resolve } from '../../core/resolver.js';
import { PathTree } from '../../core/path-tree.js';
import { SecretRef } from '../../core/types.js';

export default class ConfigList extends Command {
    static override description = 'List config paths in an environment';

    static override examples = [
        '<%= config.bin %> config:list dev',
        '<%= config.bin %> config:list dev --prefix database'
    ];

    static override args = {
        env: Args.string({ description: 'Environment name', required: true })
    };

    static override flags = {
        prefix: Flags.string({ description: 'Filter paths by prefix' })
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(ConfigList);
        const cwd = process.cwd();

        const resolved = await resolve(args.env, (name) => loadEnvironment(cwd, name));
        const tree = PathTree.fromJSON(resolved.values);
        const paths = tree.list(flags.prefix);

        const configPaths = paths.filter((p) => {
            const value = tree.get(p);
            return !(value instanceof SecretRef);
        });

        for (const p of configPaths) {
            this.log(p);
        }
    }
}
