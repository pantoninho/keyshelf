import { Args, Command } from '@oclif/core';
import { loadEnvironment, saveEnvironment } from '../../core/environment.js';
import { PathTree } from '../../core/path-tree.js';

export default class ConfigRm extends Command {
    static override description = 'Remove a config value from an environment';

    static override examples = ['<%= config.bin %> config:rm dev database/host'];

    static override args = {
        env: Args.string({ description: 'Environment name', required: true }),
        path: Args.string({ description: 'Config path to remove', required: true })
    };

    async run(): Promise<void> {
        const { args } = await this.parse(ConfigRm);
        const cwd = process.cwd();

        const def = await loadEnvironment(cwd, args.env);
        const tree = PathTree.fromJSON(def.values);

        if (tree.get(args.path) === undefined) {
            this.error(
                `Path "${args.path}" not found in environment "${args.env}". Use "keyshelf config:list ${args.env}" to see available paths.`
            );
        }

        tree.delete(args.path);
        await saveEnvironment(cwd, args.env, {
            imports: def.imports,
            values: tree.toJSON(),
            provider: def.provider
        });

        this.log(`Removed ${args.path}`);
    }
}
