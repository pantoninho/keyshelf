import { Args, Command, Flags } from '@oclif/core';
import { loadEnvironment, saveEnvironment, listEnvironments } from '../core/environment.js';
import { loadConfig, defaultConfigDir } from '../core/config.js';
import { resolve } from '../core/resolver.js';
import { PathTree } from '../core/path-tree.js';
import { SecretRef, EnvironmentDefinition } from '../core/types.js';
import { resolveProvider } from '../providers/index.js';
import { readMaskedLine } from '../core/input.js';
import { topoSort } from '../core/reconciler/topo-sort.js';

export default class SetCommand extends Command {
    static override description = 'Set a secret value in an environment';

    static override examples = [
        '<%= config.bin %> set --env dev database/password',
        '<%= config.bin %> set --env dev database/password mysecret'
    ];

    static override args = {
        path: Args.string({ description: 'Secret path (slash-delimited)', required: true }),
        value: Args.string({ description: 'Secret value (prompted if omitted)', required: false })
    };

    static override flags = {
        env: Flags.string({ description: 'Environment name', required: true }),
        'config-dir': Flags.string({ description: 'Override config directory', hidden: true })
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(SetCommand);
        const cwd = process.cwd();
        const envName = flags.env;

        const resolved = await resolve(envName, (name) => loadEnvironment(cwd, name));
        const resolvedTree = PathTree.fromJSON(resolved.values);
        const existing = resolvedTree.get(args.path);

        await this.ensureSecretRef(cwd, envName, args.path, existing);

        const value = args.value ?? (await readMaskedLine(`Enter value for "${args.path}": `));

        const config = loadConfig(cwd);
        const configDir = flags['config-dir'] ?? defaultConfigDir(config);
        const envDef = await loadEnvironment(cwd, envName);
        const provider = resolveProvider(envDef, config, configDir);
        await provider.set(envName, args.path, value);

        await this.propagateToImporters(cwd, envName, args.path, value, config, configDir);
    }

    private async ensureSecretRef(
        cwd: string,
        envName: string,
        secretPath: string,
        existing: unknown
    ): Promise<void> {
        if (existing instanceof SecretRef) return;

        if (existing !== undefined) {
            process.stderr.write(
                `Warning: Overwriting plain value at ${secretPath} with a secret reference\n`
            );
        }

        await this.addSecretRefToEnv(cwd, envName, secretPath);
    }

    private async addSecretRefToEnv(
        cwd: string,
        envName: string,
        secretPath: string
    ): Promise<void> {
        const envDef = await loadEnvironment(cwd, envName);
        const tree = PathTree.fromJSON(envDef.values);
        tree.set(secretPath, new SecretRef(secretPath));
        const updated: EnvironmentDefinition = { ...envDef, values: tree.toJSON() };
        await saveEnvironment(cwd, envName, updated);
    }

    private async propagateToImporters(
        cwd: string,
        envName: string,
        secretPath: string,
        value: string,
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
            await importerProvider.set(importerName, secretPath, value);
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
