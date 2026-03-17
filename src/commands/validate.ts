import { Command, Flags } from '@oclif/core';
import { listEnvironments, loadEnvironment } from '../core/environment.js';
import { loadConfig, defaultConfigDir, findProjectRoot } from '../core/config.js';
import { resolve } from '../core/resolver.js';
import { SecretRef } from '../core/types.js';
import { resolveProvider } from '../providers/index.js';
import { topoSort } from '../core/reconciler/topo-sort.js';
import { EnvironmentDefinition } from '../core/types.js';

export default class Validate extends Command {
    static override description =
        'Check that all secrets exist in their providers across all environments';

    static override examples = ['<%= config.bin %> validate'];

    static override flags = {
        'config-dir': Flags.string({ description: 'Override config directory', hidden: true })
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(Validate);
        const projectRoot = findProjectRoot(process.cwd());
        if (!projectRoot) {
            this.error('keyshelf.yml not found in current directory or any parent directory.');
        }

        const config = loadConfig(projectRoot);
        const configDir = flags['config-dir'] ?? defaultConfigDir(config);
        const envNames = await listEnvironments(projectRoot);

        if (envNames.length === 0) {
            this.log('No environments found.');
            return;
        }

        const envDefs = await loadAllEnvDefs(projectRoot, envNames);
        const sortedNames = topoSort(
            Object.fromEntries(envNames.map((n) => [n, { imports: envDefs.get(n)!.imports }]))
        );

        let hasFailures = false;

        for (const envName of sortedNames) {
            const envDef = envDefs.get(envName)!;
            const provider = resolveProvider(envDef, config, configDir);
            const resolved = await resolve(envName, (name) => Promise.resolve(envDefs.get(name)!));

            const secretPaths = collectSecretPaths(resolved.values);
            const storedPaths = new Set(await provider.list(envName));
            const missing = secretPaths.filter((p) => !storedPaths.has(p));

            if (missing.length === 0) {
                this.log(`✓ ${envName}: ${secretPaths.length} secrets OK`);
            } else {
                hasFailures = true;
                this.log(`✗ ${envName}: missing ${missing.length} secrets`);
                for (const p of missing) {
                    this.log(`  ${p}`);
                }
            }
        }

        if (hasFailures) {
            this.exit(1);
        }
    }
}

async function loadAllEnvDefs(
    projectRoot: string,
    envNames: string[]
): Promise<Map<string, EnvironmentDefinition>> {
    const entries = await Promise.all(
        envNames.map(async (name) => [name, await loadEnvironment(projectRoot, name)] as const)
    );
    return new Map(entries);
}

function collectSecretPaths(values: Record<string, unknown>, prefix = ''): string[] {
    const paths: string[] = [];
    for (const [key, value] of Object.entries(values)) {
        const fullPath = prefix ? `${prefix}/${key}` : key;
        if (value instanceof SecretRef) {
            paths.push(fullPath);
        } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            paths.push(...collectSecretPaths(value as Record<string, unknown>, fullPath));
        }
    }
    return paths;
}
