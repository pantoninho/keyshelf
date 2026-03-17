import { Args, Command, Flags } from '@oclif/core';
import { loadEnvironment, saveEnvironment, listEnvironments } from '../core/environment.js';
import { loadConfig, defaultConfigDir, findProjectRoot } from '../core/config.js';
import { resolve } from '../core/resolver.js';
import { PathTree } from '../core/path-tree.js';
import { SecretRef } from '../core/types.js';
import { resolveProvider } from '../providers/index.js';
import { topoSort } from '../core/reconciler/topo-sort.js';

export default class RmCommand extends Command {
    static override description = 'Remove a secret or config value from an environment';

    static override examples = [
        '<%= config.bin %> rm --env dev database/password',
        '<%= config.bin %> rm --env base shared/token'
    ];

    static override args = {
        path: Args.string({ description: 'Path to remove (slash-delimited)', required: true })
    };

    static override flags = {
        env: Flags.string({ description: 'Environment name', required: true }),
        'config-dir': Flags.string({ description: 'Override config directory', hidden: true })
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(RmCommand);
        const projectRoot = findProjectRoot(process.cwd());
        if (!projectRoot) {
            this.error('keyshelf.yml not found in current directory or any parent directory.');
        }

        const envName = flags.env;
        const resolved = await resolve(envName, (name) => loadEnvironment(projectRoot, name));
        const resolvedTree = PathTree.fromJSON(resolved.values);
        const existing = resolvedTree.get(args.path);

        if (existing === undefined) {
            this.error(`Path "${args.path}" does not exist in environment "${envName}".`);
        }

        const envDef = await loadEnvironment(projectRoot, envName);
        const directTree = PathTree.fromJSON(envDef.values);
        const directValue = directTree.get(args.path);

        if (directValue === undefined) {
            this.error(
                `Path "${args.path}" is inherited, not defined directly in "${envName}". Remove it from the source environment instead.`
            );
        }

        const isSecret = directValue instanceof SecretRef;
        const config = loadConfig(projectRoot);
        const configDir = flags['config-dir'] ?? defaultConfigDir(config);

        if (isSecret) {
            await this.propagateRemovals(projectRoot, envName, args.path, config, configDir);
            const provider = resolveProvider(envDef, config, configDir);
            await provider.delete(envName, args.path);
        }

        directTree.delete(args.path);
        await saveEnvironment(projectRoot, envName, { ...envDef, values: directTree.toJSON() });
        this.log(`✓ ${envName} ${args.path}`);
    }

    private async propagateRemovals(
        cwd: string,
        envName: string,
        secretPath: string,
        config: ReturnType<typeof loadConfig>,
        configDir: string
    ): Promise<void> {
        const allEnvNames = await listEnvironments(cwd);
        const envDefs = await this.loadAllEnvDefs(cwd, allEnvNames);
        const sorted = topoSort(envDefs);
        const importers = this.findTransitiveImporters(envDefs, envName, sorted);

        for (const importerName of importers) {
            const resolved = await resolve(importerName, (name) => loadEnvironment(cwd, name));
            const tree = PathTree.fromJSON(resolved.values);
            const ref = tree.get(secretPath);
            if (!(ref instanceof SecretRef)) continue;

            this.log(`↻ ${importerName} ${secretPath} (from ${envName})`);
            const importerDef = await loadEnvironment(cwd, importerName);
            const importerProvider = resolveProvider(importerDef, config, configDir);
            await importerProvider.delete(importerName, secretPath);
        }
    }

    private async loadAllEnvDefs(
        cwd: string,
        envNames: string[]
    ): Promise<Record<string, { imports: string[] }>> {
        const entries = await Promise.all(
            envNames.map(async (name) => {
                const def = await loadEnvironment(cwd, name);
                return [name, { imports: def.imports }] as const;
            })
        );
        return Object.fromEntries(entries);
    }

    private findTransitiveImporters(
        envDefs: Record<string, { imports: string[] }>,
        targetEnv: string,
        sorted: string[]
    ): string[] {
        const importers = new Set<string>();
        for (const name of sorted) {
            if (name === targetEnv) continue;
            const { imports } = envDefs[name];
            const importsTarget =
                imports.includes(targetEnv) || imports.some((imp) => importers.has(imp));
            if (importsTarget) importers.add(name);
        }
        return sorted.filter((name) => importers.has(name));
    }
}
