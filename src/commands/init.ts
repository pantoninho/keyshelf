import { Command, Flags } from '@oclif/core';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export default class Init extends Command {
    static override description = 'Initialize a new keyshelf project';

    static override examples = ['<%= config.bin %> init', '<%= config.bin %> init --force'];

    static override flags = {
        force: Flags.boolean({ char: 'f', description: 'Overwrite existing keyshelf.yml' }),
        adapter: Flags.string({
            description: 'Secret provider adapter',
            options: ['local', 'gcp-sm', 'aws-sm'],
            default: 'local'
        }),
        project: Flags.string({
            description: 'GCP project ID (required for gcp-sm adapter)'
        }),
        region: Flags.string({
            description: 'AWS region (optional for aws-sm adapter)'
        })
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(Init);
        const cwd = process.cwd();
        const configPath = path.join(cwd, 'keyshelf.yml');

        if (fs.existsSync(configPath) && !flags.force) {
            this.error('keyshelf.yml already exists (use --force to overwrite)');
        }

        let provider: Record<string, string>;
        switch (flags.adapter) {
            case 'gcp-sm':
                if (!flags.project) {
                    this.error('--project is required when using the gcp-sm adapter');
                }
                provider = { adapter: 'gcp-sm', project: flags.project };
                break;
            case 'aws-sm':
                provider = {
                    adapter: 'aws-sm',
                    ...(flags.region && { region: flags.region })
                };
                break;
            default:
                provider = { adapter: 'local' };
        }

        const config = {
            name: path.basename(cwd),
            provider
        };

        fs.writeFileSync(configPath, yaml.dump(config), 'utf-8');
        fs.mkdirSync(path.join(cwd, '.keyshelf', 'environments'), { recursive: true });

        this.log('Initialized keyshelf project');
    }
}
