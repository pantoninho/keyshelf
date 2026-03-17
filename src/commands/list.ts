import { Command, Flags } from '@oclif/core';
import { loadEnvironment } from '../core/environment.js';
import { resolve } from '../core/resolver.js';
import { PathTree } from '../core/path-tree.js';
import { SecretRef } from '../core/types.js';

export default class List extends Command {
    static override description = 'List all paths in an environment';

    static override examples = ['<%= config.bin %> list --env dev'];

    static override flags = {
        env: Flags.string({ description: 'Environment name', required: true })
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(List);
        const cwd = process.cwd();

        const resolved = await resolve(flags.env, (name) => loadEnvironment(cwd, name));
        const tree = PathTree.fromJSON(resolved.values);
        const paths = tree.list();

        for (const p of paths) {
            const value = tree.get(p);
            const suffix = value instanceof SecretRef ? ' (secret)' : '';
            this.log(`${p}${suffix}`);
        }
    }
}
