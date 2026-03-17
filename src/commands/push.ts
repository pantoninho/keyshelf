import { Command, Flags } from '@oclif/core';
import { loadEnvironment } from '../core/environment.js';
import { loadConfig, defaultConfigDir, findProjectRoot } from '../core/config.js';
import { resolve } from '../core/resolver.js';
import { replaceSecrets, flattenToEnvRecord, classifyEnvRecord } from '../core/env-vars.js';
import { resolveProvider } from '../providers/index.js';
import { loadEnvMapping } from '../core/env-keyshelf.js';
import { buildPushPlan, renderPushPlan, PushPlan } from '../core/push-plan.js';
import { createTarget } from '../targets/index.js';
import { DeployTarget } from '../targets/target.js';

export default class Push extends Command {
    static override description = 'Push resolved environment config to a deploy target';

    static override flags = {
        env: Flags.string({ description: 'Environment name', required: true }),
        target: Flags.string({ description: 'Deploy target name', required: true }),
        apply: Flags.boolean({ description: 'Apply changes', default: false }),
        'config-dir': Flags.string({ description: 'Override config directory', hidden: true })
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(Push);

        const projectRoot = findProjectRoot(process.cwd());
        if (!projectRoot) {
            this.error('keyshelf.yml not found in current directory or any parent directory.');
        }

        const config = loadConfig(projectRoot);
        const envDef = await loadEnvironment(projectRoot, flags.env);

        const targetConfig = envDef.targets?.[flags.target];
        if (!targetConfig) {
            this.error(`Target "${flags.target}" is not configured in environment "${flags.env}".`);
        }

        const envMapping = loadEnvMapping(process.cwd());
        if (Object.keys(envMapping).length === 0) {
            this.error(
                '.env.keyshelf not found or empty. Create it to map keyshelf paths to env var names before pushing.'
            );
        }

        const configDir = flags['config-dir'] ?? defaultConfigDir(config);
        const resolved = await resolve(flags.env, (name) => loadEnvironment(projectRoot, name));
        const provider = resolveProvider(envDef, config, configDir);

        const revealed = await replaceSecrets(resolved.values, flags.env, provider, 'reveal');
        const flatValues = flattenToEnvRecord(revealed, envMapping);
        const sensitivity = classifyEnvRecord(resolved.values, envMapping);

        const desired = buildDesiredRecord(flatValues, sensitivity);

        const target = createTarget(targetConfig);
        const current = await target.list();
        const plan = buildPushPlan(flags.target, desired, current);

        this.log(renderPushPlan(plan));

        if (plan.changes.length === 0) return;

        if (!flags.apply) {
            this.log('Run with --apply to execute changes.');
            return;
        }

        await applyPlan(plan, desired, target);
        this.log('Done.');
    }
}

/** Build the desired state record combining flattened values with sensitivity flags. */
function buildDesiredRecord(
    flatValues: Record<string, string>,
    sensitivity: Record<string, boolean>
): Record<string, { value: string; sensitive: boolean }> {
    const desired: Record<string, { value: string; sensitive: boolean }> = {};
    for (const [key, value] of Object.entries(flatValues)) {
        desired[key] = { value, sensitive: sensitivity[key] ?? false };
    }
    return desired;
}

/** Apply all changes in the plan to the target. */
async function applyPlan(
    plan: PushPlan,
    desired: Record<string, { value: string; sensitive: boolean }>,
    target: DeployTarget
): Promise<void> {
    for (const change of plan.changes) {
        if (change.kind === 'add' || change.kind === 'update') {
            const { value, sensitive } = desired[change.key];
            await target.set(change.key, value, sensitive);
        } else {
            await target.delete(change.key);
        }
    }
}
