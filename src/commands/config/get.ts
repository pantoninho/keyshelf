import { Args, Command } from '@oclif/core';
import yaml from 'js-yaml';
import { loadEnvironment } from '../../core/environment.js';
import { resolve } from '../../core/resolver.js';
import { PathTree } from '../../core/path-tree.js';

export default class ConfigGet extends Command {
    static override description = 'Get a config value from an environment';

    static override examples = ['<%= config.bin %> config:get dev database/host'];

    static override args = {
        env: Args.string({ description: 'Environment name', required: true }),
        path: Args.string({ description: 'Config path (slash-delimited)', required: true })
    };

    async run(): Promise<void> {
        const { args } = await this.parse(ConfigGet);
        const cwd = process.cwd();

        const resolved = await resolve(args.env, (name) => loadEnvironment(cwd, name));
        const tree = PathTree.fromJSON(resolved.values);
        const value = tree.get(args.path);

        if (value === undefined) {
            this.error(
                `Path "${args.path}" not found in environment "${args.env}". Use "keyshelf config:list ${args.env}" to see available paths.`
            );
        }

        if (typeof value === 'object' && value !== null) {
            this.log(yaml.dump(value).trimEnd());
        } else {
            this.log(String(value));
        }
    }
}
