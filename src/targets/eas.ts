import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EasEnvironment } from '../core/types.js';
import { DeployTarget } from './target.js';

const execFileAsync = promisify(execFile);

/** Adapter for the EAS (Expo Application Services) CLI. */
export class EasTarget implements DeployTarget {
    constructor(private readonly environment: EasEnvironment) {}

    /**
     * List all env vars for this environment from EAS.
     *
     * @returns Record mapping env var names to their current values
     */
    async list(): Promise<Record<string, string>> {
        const stdout = await this.runEas([
            'env:list',
            '--environment',
            this.environment,
            '--format',
            'short',
            '--include-sensitive',
            '--non-interactive'
        ]);
        return parseEnvVarOutput(stdout);
    }

    /**
     * Create or update an env var on EAS.
     *
     * @param key - The env var name
     * @param value - The env var value
     * @param sensitive - Whether to store as sensitive (hidden) or plaintext
     */
    async set(key: string, value: string, sensitive: boolean): Promise<void> {
        await this.runEas([
            'env:create',
            '--name',
            key,
            '--value',
            value,
            '--environment',
            this.environment,
            '--visibility',
            sensitive ? 'sensitive' : 'plaintext',
            '--force',
            '--non-interactive'
        ]);
    }

    /**
     * Delete an env var from EAS.
     *
     * @param key - The env var name to delete
     */
    async delete(key: string): Promise<void> {
        await this.runEas([
            'env:delete',
            '--variable-name',
            key,
            '--variable-environment',
            this.environment,
            '--non-interactive'
        ]);
    }

    /**
     * Run an eas CLI command with the given arguments.
     *
     * Uses execFile with array args to prevent shell injection — critical since
     * values may be secrets.
     *
     * @param args - CLI arguments to pass to eas
     * @returns stdout from the command
     */
    private async runEas(args: string[]): Promise<string> {
        try {
            const { stdout } = await execFileAsync('eas', args, { encoding: 'utf-8' });
            return stdout;
        } catch (err) {
            const nodeErr = err as NodeJS.ErrnoException & { stderr?: string };

            if (nodeErr.code === 'ENOENT') {
                throw new Error('eas CLI not found. Install with: npm install -g eas-cli');
            }

            // Never include args in the error — they may contain secret values
            throw new Error(`EAS CLI failed: ${nodeErr.stderr ?? nodeErr.message}`);
        }
    }
}

/** Parse NAME=value lines into a key-value record. Lines without = are skipped. */
function parseEnvVarOutput(stdout: string): Record<string, string> {
    const result: Record<string, string> = {};

    for (const line of stdout.split('\n')) {
        const eqIndex = line.indexOf('=');
        if (eqIndex === -1) continue;

        const key = line.slice(0, eqIndex);
        const value = line.slice(eqIndex + 1);

        if (key) result[key] = value;
    }

    return result;
}
