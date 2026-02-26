import { Command, Flags } from '@oclif/core';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export default class Init extends Command {
    static override description = 'Initialize a new keyshelf project';

    static override examples = ['<%= config.bin %> init', '<%= config.bin %> init --force'];

    static override flags = {
        force: Flags.boolean({ char: 'f', description: 'Overwrite existing keyshelf.yml' })
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(Init);
        const cwd = process.cwd();
        const configPath = path.join(cwd, 'keyshelf.yml');

        if (fs.existsSync(configPath) && !flags.force) {
            this.error('keyshelf.yml already exists (use --force to overwrite)');
        }

        const config = {
            name: path.basename(cwd),
            provider: { adapter: 'local' }
        };

        fs.writeFileSync(configPath, yaml.dump(config), 'utf-8');
        fs.mkdirSync(path.join(cwd, '.keyshelf', 'environments'), { recursive: true });

        this.log('Initialized keyshelf project');
    }
}
