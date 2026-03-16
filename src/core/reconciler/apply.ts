import { SecretProvider } from '../../providers/provider.js';
import { EnvironmentPlan } from './types.js';

interface ApplyOptions {
    plan: EnvironmentPlan;
    provider: SecretProvider;
    collectValue: (path: string) => Promise<string>;
    getSourceProvider: (sourceEnv: string) => { provider: SecretProvider; env: string };
}

/**
 * Execute an environment plan against its provider.
 *
 * @param options.plan - The plan describing what changes to make
 * @param options.provider - The provider for the target environment
 * @param options.collectValue - Async function to obtain a value for a given secret path
 * @param options.getSourceProvider - Returns the provider and env name for a source environment
 */
export async function applyEnvironmentPlan(options: ApplyOptions): Promise<void> {
    const { plan, provider, collectValue, getSourceProvider } = options;

    for (const change of plan.secretChanges) {
        switch (change.kind) {
            case 'add': {
                const value = await collectValue(change.path);
                await provider.set(plan.envName, change.path, value);
                break;
            }
            case 'copy': {
                const source = getSourceProvider(change.sourceEnv);
                const value = await source.provider.get(source.env, change.path);
                await provider.set(plan.envName, change.path, value);
                break;
            }
            case 'remove': {
                await provider.delete(plan.envName, change.path);
                break;
            }
        }
    }
}
