import { Args, Command, Flags } from '@oclif/core';
import fs from 'node:fs';
import path from 'node:path';
import { saveEnvironment } from '../../core/environment.js';
import { EnvironmentDefinition, ProviderConfig } from '../../core/types.js';

export default class EnvCreate extends Command {
    static override description = 'Create a new environment';

    static override examples = [
        '<%= config.bin %> env:create dev',
        '<%= config.bin %> env:create staging --import base --import shared',
        '<%= config.bin %> env:create production --adapter gcp-sm --project myapp-prod'
    ];

    static override args = {
        name: Args.string({ description: 'Environment name', required: true })
    };

    static override flags = {
        import: Flags.string({
            char: 'i',
            description: 'Import another environment',
            multiple: true,
            default: []
        }),
        adapter: Flags.string({
            description: 'Secret provider adapter for this environment',
            options: ['local', 'gcp-sm', 'aws-sm']
        }),
        project: Flags.string({
            description: 'GCP project ID (required for gcp-sm adapter)'
        }),
        region: Flags.string({
            description: 'AWS region (optional for aws-sm adapter)'
        })
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(EnvCreate);
        const cwd = process.cwd();
        const envPath = path.join(cwd, '.keyshelf', 'environments', `${args.name}.yml`);

        if (fs.existsSync(envPath)) {
            this.error(`Environment "${args.name}" already exists at ${envPath}.`);
        }

        let provider: ProviderConfig | undefined;
        if (flags.adapter) {
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
        }

        const def: EnvironmentDefinition = {
            imports: flags.import,
            values: {},
            provider
        };

        await saveEnvironment(cwd, args.name, def);

        this.log(`Created environment "${args.name}"`);
    }
}
