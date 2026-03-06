import { Args, Command } from '@oclif/core';
import { loadEnvironment, saveEnvironment } from '../../core/environment.js';
import { PathTree } from '../../core/path-tree.js';

export default class ConfigAdd extends Command {
    static override description = 'Add a config value to an environment';

    static override examples = ['<%= config.bin %> config:add dev database/host localhost'];

    static override args = {
        env: Args.string({ description: 'Environment name', required: true }),
        path: Args.string({ description: 'Config path (slash-delimited)', required: true }),
        value: Args.string({ description: 'Config value', required: true })
    };

    async run(): Promise<void> {
        const { args } = await this.parse(ConfigAdd);
        const cwd = process.cwd();

        const def = await loadEnvironment(cwd, args.env);
        const tree = PathTree.fromJSON(def.values);
        tree.set(args.path, args.value);

        await saveEnvironment(cwd, args.env, {
            imports: def.imports,
            values: tree.toJSON(),
            provider: def.provider
        });
        this.log(`Set ${args.path} = ${args.value}`);
    }
}
