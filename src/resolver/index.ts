import type { KeyDefinition } from "../config/schema.js";
import type { EnvConfig } from "../config/environment.js";
import { isTaggedValue, type TaggedValue } from "../config/yaml-tags.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { ResolvedKey, ValidationError } from "./types.js";

export interface ResolveOptions {
  schema: KeyDefinition[];
  env: EnvConfig;
  envName: string;
  registry: ProviderRegistry;
}

export async function validate(options: ResolveOptions): Promise<ValidationError[]> {
  const { schema, env, envName, registry } = options;
  const errors: ValidationError[] = [];

  for (const key of schema) {
    try {
      await resolveKey(key, env, envName, registry);
    } catch (err) {
      errors.push({
        path: key.path,
        message: err instanceof Error ? err.message : String(err)
      });
    }
  }

  return errors;
}

export async function resolve(options: ResolveOptions): Promise<ResolvedKey[]> {
  const { schema, env, envName, registry } = options;
  const results: ResolvedKey[] = [];

  for (const key of schema) {
    const value = await resolveKey(key, env, envName, registry);
    if (value !== undefined) {
      results.push({ path: key.path, value });
    }
  }

  return results;
}

async function resolveKey(
  key: KeyDefinition,
  env: EnvConfig,
  envName: string,
  registry: ProviderRegistry
): Promise<string | undefined> {
  const override = env.overrides[key.path];

  // 1. Env file explicit override (plaintext)
  if (override !== undefined && !isTaggedValue(override)) {
    return String(override);
  }

  // 2. Env file explicit override (provider-tagged)
  if (override !== undefined && isTaggedValue(override)) {
    try {
      return await resolveViaProvider(key.path, override, env, envName, registry);
    } catch (err) {
      if (key.optional) return undefined;
      throw err;
    }
  }

  // 3. Secret with default provider
  if (key.isSecret && env.defaultProvider) {
    const provider = registry.get(env.defaultProvider.name);
    const ctx = {
      keyPath: key.path,
      envName,
      config: { ...env.defaultProvider.options }
    };
    try {
      return await provider.resolve(ctx);
    } catch (err) {
      if (key.optional) return undefined;
      throw err;
    }
  }

  // 4. Schema default (config only, not secrets)
  if (!key.isSecret && key.defaultValue !== undefined) {
    return key.defaultValue;
  }

  // 5. Error (required secret) or skip (optional secret)
  if (key.optional) {
    return undefined;
  }

  throw new Error(`No value for required key "${key.path}"`);
}

async function resolveViaProvider(
  keyPath: string,
  tagged: TaggedValue,
  env: EnvConfig,
  envName: string,
  registry: ProviderRegistry
): Promise<string> {
  const provider = registry.get(tagged.tag);
  const baseConfig =
    env.defaultProvider?.name === tagged.tag ? { ...env.defaultProvider.options } : {};
  const ctx = {
    keyPath,
    envName,
    config: { ...baseConfig, ...tagged.config }
  };
  return provider.resolve(ctx);
}
