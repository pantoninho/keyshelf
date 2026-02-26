import { Args, Command, Flags } from '@oclif/core';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import fs from 'node:fs';
import { loadEnvironment, saveEnvironment } from '../../core/environment.js';
import { PathTree } from '../../core/path-tree.js';
import { SecretRef, KeyshelfConfig } from '../../core/types.js';
import { LocalProvider } from '../../providers/local.js';

export default class SecretAdd extends Command {
    static override description = 'Add a secret to an environment';

    static override examples = [
        '<%= config.bin %> secret:add dev database/password s3cret'
    ];

    static override args = {
        env: Args.string({ description: 'Environment name', required: true }),
        path: Args.string({ description: 'Secret path (slash-delimited)', required: true }),
        value: Args.string({ description: 'Secret value', required: true })
    };

    static override flags = {
        'config-dir': Flags.string({ description: 'Override config directory', hidden: true })
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(SecretAdd);
        const cwd = process.cwd();

        const def = await loadEnvironment(cwd, args.env);
        const provider = new LocalProvider(flags['config-dir'] ?? defaultConfigDir(cwd));

        await provider.set(args.env, args.path, args.value);

        const tree = PathTree.fromJSON(def.values);
        tree.set(args.path, new SecretRef(args.path));
        await saveEnvironment(cwd, args.env, { imports: def.imports, values: tree.toJSON() });

        this.log(`Secret set at ${args.path}`);
    }
}

function defaultConfigDir(cwd: string): string {
    const configPath = path.join(cwd, 'keyshelf.yml');
    const config = yaml.load(fs.readFileSync(configPath, 'utf-8')) as KeyshelfConfig;
    return path.join(os.homedir(), '.config', 'keyshelf', config.name);
}
