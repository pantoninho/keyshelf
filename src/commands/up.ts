import { Command, Flags } from '@oclif/core';
import fs from 'node:fs/promises';
import readline from 'node:readline';
import { listEnvironments, loadEnvironment } from '../core/environment.js';
import { loadConfig, defaultConfigDir, findProjectRoot } from '../core/config.js';
import { resolve as resolveEnv } from '../core/resolver.js';
import { resolveProvider } from '../providers/index.js';
import { EnvironmentDefinition, KeyshelfConfig } from '../core/types.js';
import { topoSort } from '../core/reconciler/topo-sort.js';
import { buildEnvironmentPlan } from '../core/reconciler/diff.js';
import { applyEnvironmentPlan } from '../core/reconciler/apply.js';
import { makeCollector } from '../core/reconciler/input.js';
import { renderPlan } from '../core/reconciler/render.js';
import { parseEnvFile } from '../core/env-file.js';
import { ReconciliationPlan, EnvironmentPlan } from '../core/reconciler/types.js';

export default class Up extends Command {
    static override description =
        'Reconcile all environments — show a plan of secret changes and optionally apply it';

    static override examples = [
        '<%= config.bin %> up',
        '<%= config.bin %> up --apply',
        '<%= config.bin %> up --apply --from-file .env.secrets'
    ];

    static override flags = {
        apply: Flags.boolean({
            description: 'Apply changes without interactive confirmation',
            default: false
        }),
        'from-file': Flags.string({
            description: 'Read new secret values from a KEY=VALUE file'
        }),
        'config-dir': Flags.string({ description: 'Override config directory', hidden: true })
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(Up);
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
        const ctx: PlanContext = { envDefs, config, configDir, projectRoot };
        const plan = await buildReconciliationPlan(ctx, sortedNames);

        this.log(renderPlan(plan));

        const hasChanges = plan.environments.some((e) => e.secretChanges.length > 0);
        if (!hasChanges) {
            this.log('Nothing to do.');
            return;
        }

        await this.confirmAndApply(flags, plan, ctx);
    }

    private async confirmAndApply(
        flags: { apply: boolean; 'from-file': string | undefined },
        plan: ReconciliationPlan,
        ctx: PlanContext
    ): Promise<void> {
        const shouldApply = flags.apply || (await confirmApply());
        if (!shouldApply) {
            this.log('Aborted.');
            return;
        }

        const collector = await buildCollector(flags['from-file']);

        for (const envPlan of plan.environments) {
            if (envPlan.secretChanges.length === 0) continue;
            const envDef = ctx.envDefs.get(envPlan.envName)!;
            const provider = resolveProvider(envDef, ctx.config, ctx.configDir);
            await applyEnvironmentPlan({
                plan: envPlan,
                provider,
                collectValue: collector,
                getSourceProvider: (sourceEnv) => ({
                    provider: resolveProvider(
                        ctx.envDefs.get(sourceEnv)!,
                        ctx.config,
                        ctx.configDir
                    ),
                    env: sourceEnv
                })
            });
        }

        this.log('Done.');
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

interface PlanContext {
    envDefs: Map<string, EnvironmentDefinition>;
    config: KeyshelfConfig;
    configDir: string;
    projectRoot: string;
}

async function buildReconciliationPlan(
    ctx: PlanContext,
    sortedNames: string[]
): Promise<ReconciliationPlan> {
    const environments: EnvironmentPlan[] = [];
    const cachedSecrets = new Map<string, string[]>();

    for (const envName of sortedNames) {
        const envDef = ctx.envDefs.get(envName)!;
        const provider = resolveProvider(envDef, ctx.config, ctx.configDir);
        const resolved = await resolveEnv(envName, (name) =>
            Promise.resolve(ctx.envDefs.get(name)!)
        );
        const providerSecretPaths = await provider.list(envName);
        cachedSecrets.set(envName, providerSecretPaths);

        const importedSecretSources = buildImportedSecretSources(envDef.imports, cachedSecrets);

        const envPlan = buildEnvironmentPlan({
            envName,
            resolvedSecretPaths: resolved.secretRefs,
            providerSecretPaths,
            importedSecretSources
        });

        environments.push(envPlan);
    }

    return { environments };
}

function buildImportedSecretSources(
    imports: string[],
    cachedSecrets: Map<string, string[]>
): Map<string, string> {
    const sources = new Map<string, string>();
    for (const importName of imports) {
        const secretPaths = cachedSecrets.get(importName) ?? [];
        for (const secretPath of secretPaths) {
            if (!sources.has(secretPath)) {
                sources.set(secretPath, importName);
            }
        }
    }
    return sources;
}

async function confirmApply(): Promise<boolean> {
    return new Promise((resolveConfirm) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.question('Apply changes? (y/N) ', (answer) => {
            rl.close();
            resolveConfirm(answer.toLowerCase() === 'y');
        });
    });
}

async function buildCollector(
    fromFile: string | undefined
): Promise<(path: string) => Promise<string>> {
    if (fromFile) {
        const content = await fs.readFile(fromFile, 'utf-8');
        const values = parseEnvFile(content);
        return makeCollector({ kind: 'file', values });
    }

    return makeCollector({ kind: 'prompt' });
}
