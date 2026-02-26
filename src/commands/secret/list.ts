import { Args, Command, Flags } from '@oclif/core';
import { loadEnvironment } from '../../core/environment.js';
import { resolve } from '../../core/resolver.js';
import { PathTree } from '../../core/path-tree.js';
import { SecretRef } from '../../core/types.js';

export default class SecretList extends Command {
    static override description = 'List secret paths in an environment';

    static override examples = [
        '<%= config.bin %> secret:list dev',
        '<%= config.bin %> secret:list dev --prefix database'
    ];

    static override args = {
        env: Args.string({ description: 'Environment name', required: true })
    };

    static override flags = {
        prefix: Flags.string({ description: 'Filter paths by prefix' })
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(SecretList);
        const cwd = process.cwd();

        const resolved = await resolve(args.env, (name) => loadEnvironment(cwd, name));
        const tree = PathTree.fromJSON(resolved.values);
        const paths = tree.list(flags.prefix);

        const secretPaths = paths.filter((p) => {
            const value = tree.get(p);
            return value instanceof SecretRef;
        });

        for (const p of secretPaths) {
            this.log(p);
        }
    }
}
