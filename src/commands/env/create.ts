import { Args, Command, Flags } from '@oclif/core';
import fs from 'node:fs';
import path from 'node:path';
import { saveEnvironment } from '../../core/environment.js';

export default class EnvCreate extends Command {
    static override description = 'Create a new environment';

    static override examples = [
        '<%= config.bin %> env:create dev',
        '<%= config.bin %> env:create staging --import base --import shared'
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
        })
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(EnvCreate);
        const cwd = process.cwd();
        const envPath = path.join(cwd, '.keyshelf', 'environments', `${args.name}.yml`);

        if (fs.existsSync(envPath)) {
            this.error(`Environment "${args.name}" already exists`);
        }

        await saveEnvironment(cwd, args.name, {
            imports: flags.import,
            values: {}
        });

        this.log(`Created environment "${args.name}"`);
    }
}
