import { loadEnvironment } from './environment.js';
import { loadConfig, defaultConfigDir } from './config.js';
import { resolve } from './resolver.js';
import { replaceSecrets, flattenToEnvRecord } from './env-vars.js';
import { resolveProvider } from '../providers/index.js';
import { EnvironmentDefinition } from './types.js';

interface ResolveEnvOptions {
    env: string;
    projectDir: string;
    configDir?: string;
    envMapping: Record<string, string>;
}

/**
 * Resolve an environment to a flat env var record, with secrets replaced.
 *
 * @param options.env - Environment name to resolve
 * @param options.projectDir - Path to project root containing keyshelf.yml
 * @param options.configDir - Override for the provider config directory
 * @param options.envMapping - Mapping of env var names to slash-delimited value paths
 * @returns Flat record of env var names to string values
 */
export async function resolveEnv(options: ResolveEnvOptions): Promise<Record<string, string>> {
    const { env, projectDir, envMapping } = options;
    const cache = new Map<string, EnvironmentDefinition>();
    const loadFn = async (name: string) => {
        const cached = cache.get(name);
        if (cached) return cached;
        const def = await loadEnvironment(projectDir, name);
        cache.set(name, def);
        return def;
    };

    const envDef = await loadFn(env);
    const resolved = await resolve(env, loadFn);
    const config = loadConfig(projectDir);
    const configDir = options.configDir ?? defaultConfigDir(config);
    const provider = resolveProvider(envDef, config, configDir);
    const replaced = await replaceSecrets(resolved.values, env, provider, 'reveal');
    return flattenToEnvRecord(replaced, envMapping);
}
