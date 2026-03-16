import { Command, Flags } from '@oclif/core';
import fs from 'node:fs/promises';
import readline from 'node:readline';
import { listEnvironments, loadEnvironment } from '../core/environment.js';
import { loadConfig, defaultConfigDir } from '../core/config.js';
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
        '<%= config.bin %> up --apply --from-env',
        '<%= config.bin %> up --apply --from-file .env.secrets'
    ];

    static override flags = {
        apply: Flags.boolean({
            description: 'Apply changes without interactive confirmation',
            default: false
        }),
        'from-env': Flags.boolean({
            description: 'Read new secret values from process environment variables',
            default: false
        }),
        'from-file': Flags.string({
            description: 'Read new secret values from a KEY=VALUE file'
        }),
        'config-dir': Flags.string({ description: 'Override config directory', hidden: true })
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(Up);
        const cwd = process.cwd();
        const config = loadConfig(cwd);
        const configDir = flags['config-dir'] ?? defaultConfigDir(config);

        const envNames = await listEnvironments(cwd);
        if (envNames.length === 0) {
            this.log('No environments found.');
            return;
        }

        const envDefs = await loadAllEnvDefs(cwd, envNames);
        const sortedNames = topoSort(
            Object.fromEntries(envNames.map((n) => [n, { imports: envDefs.get(n)!.imports }]))
        );
        const ctx: PlanContext = { envDefs, config, configDir };
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
        flags: { apply: boolean; 'from-env': boolean; 'from-file': string | undefined },
        plan: ReconciliationPlan,
        ctx: PlanContext
    ): Promise<void> {
        const shouldApply = flags.apply || (await confirmApply());
        if (!shouldApply) {
            this.log('Aborted.');
            return;
        }

        const collector = await buildCollector(flags['from-env'], flags['from-file'], ctx.envDefs);

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
    cwd: string,
    envNames: string[]
): Promise<Map<string, EnvironmentDefinition>> {
    const entries = await Promise.all(
        envNames.map(async (name) => [name, await loadEnvironment(cwd, name)] as const)
    );
    return new Map(entries);
}

interface PlanContext {
    envDefs: Map<string, EnvironmentDefinition>;
    config: KeyshelfConfig;
    configDir: string;
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
    fromEnv: boolean,
    fromFile: string | undefined,
    envDefs: Map<string, EnvironmentDefinition>
): Promise<(path: string) => Promise<string>> {
    if (fromFile) {
        const content = await fs.readFile(fromFile, 'utf-8');
        const values = parseEnvFile(content);
        return makeCollector({ kind: 'file', values });
    }

    if (fromEnv) {
        const mapping = buildCombinedEnvMapping(envDefs);
        return makeCollector({ kind: 'env', mapping });
    }

    return makeCollector({ kind: 'prompt' });
}

function buildCombinedEnvMapping(
    envDefs: Map<string, EnvironmentDefinition>
): Record<string, string> {
    const combined: Record<string, string> = {};
    for (const def of envDefs.values()) {
        if (def.env) {
            Object.assign(combined, def.env);
        }
    }
    return combined;
}
