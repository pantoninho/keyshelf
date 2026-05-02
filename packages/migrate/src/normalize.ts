import {
  isTaggedValue,
  type AppMapping,
  type KeyDefinition,
  type ProviderConfig,
  type TaggedValue,
  type V4Environment,
  type V4Project
} from "./load-v4.js";

export type ConfigScalar = string | number | boolean;

export interface ProviderRef {
  name: "age" | "gcp" | "sops";
  options: Record<string, unknown>;
}

export type NormalizedRecord =
  | {
      path: string;
      kind: "config";
      optional: false;
      default?: ConfigScalar;
      values?: Record<string, ConfigScalar>;
    }
  | {
      path: string;
      kind: "secret";
      optional: boolean;
      default?: ProviderRef;
      values?: Record<string, ProviderRef>;
    };

export interface NormalizedMigration {
  name: string;
  envs: string[];
  groups: string[];
  keys: NormalizedRecord[];
  appMapping: AppMapping[];
  renamedName?: {
    from: string;
    to: string;
  };
}

export interface NormalizeOptions {
  acceptRenamedName?: boolean;
}

const V5_NAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const V5_PATH_SEGMENT_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const SUPPORTED_PROVIDERS = new Set(["age", "gcp", "sops"]);

export function normalizeProject(
  project: V4Project,
  options: NormalizeOptions = {}
): NormalizedMigration {
  const name = normalizeName(project.name, options.acceptRenamedName === true);
  const envs = project.envs.map((env) => env.name).sort((a, b) => a.localeCompare(b));
  const keys = [...project.schema]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((key) => normalizeKey(key, project.envs));

  validatePaths(keys);

  return {
    name: name.value,
    envs,
    groups: [],
    keys,
    appMapping: project.appMapping,
    renamedName: name.renamed
  };
}

function normalizeName(
  name: string | undefined,
  acceptRenamedName: boolean
): { value: string; renamed?: { from: string; to: string } } {
  if (name === undefined) {
    throw new Error('keyshelf.yaml must set top-level "name" before it can be migrated');
  }

  const lower = name.toLowerCase();
  const kebab = lower.replaceAll("_", "-");
  if (name.includes("_") && !acceptRenamedName) {
    throw new Error(
      `v4 name "${name}" must be renamed to "${kebab}" for v5. Re-run with --accept-renamed-name to accept this change.`
    );
  }
  if (!V5_NAME_RE.test(kebab)) {
    throw new Error(
      `v4 name "${name}" cannot be migrated to a valid v5 name. v5 names must match ${V5_NAME_RE}.`
    );
  }

  return {
    value: kebab,
    renamed: name === kebab ? undefined : { from: name, to: kebab }
  };
}

function normalizeKey(key: KeyDefinition, envs: V4Environment[]): NormalizedRecord {
  return key.isSecret ? normalizeSecret(key, envs) : normalizeConfig(key, envs);
}

function normalizeConfig(key: KeyDefinition, envs: V4Environment[]): NormalizedRecord {
  const envValues: Record<string, ConfigScalar> = {};

  for (const env of envs) {
    const override = env.env.overrides[key.path];
    if (override === undefined) continue;
    if (isTaggedValue(override)) {
      throw new Error(
        `${env.name}:${key.path} uses a provider tag, but "${key.path}" is a config key in keyshelf.yaml`
      );
    }
    envValues[env.name] = toConfigScalar(override, `${env.name}:${key.path}`);
  }

  const fallback = key.defaultValue;
  const { defaultValue, values } = splitFallbackAndValues(fallback, envValues, envs);
  return {
    path: key.path,
    kind: "config",
    optional: false,
    ...(defaultValue !== undefined ? { default: defaultValue } : {}),
    ...(values !== undefined ? { values } : {})
  };
}

function normalizeSecret(key: KeyDefinition, envs: V4Environment[]): NormalizedRecord {
  const envValues: Record<string, ProviderRef> = {};

  for (const env of envs) {
    const override = env.env.overrides[key.path];
    if (override !== undefined && !isTaggedValue(override)) {
      throw new Error(
        `${env.name}:${key.path} has a plaintext secret override. v5 secret records require provider bindings; move the value into a provider with keyshelf set before migrating.`
      );
    }

    const provider =
      override === undefined
        ? env.env.defaultProvider === undefined
          ? undefined
          : providerRef(env.env.defaultProvider)
        : providerFromTag(override, env);
    if (provider !== undefined) {
      envValues[env.name] = provider;
    }
  }

  const { defaultValue, values } = splitFallbackAndValues(undefined, envValues, envs);
  if (defaultValue === undefined && values === undefined) {
    if (key.optional) {
      throw new Error(
        `${key.path} is optional, but v5 still requires at least one provider binding for secret records`
      );
    }
    throw new Error(`${key.path} is a required secret with no provider binding in any env`);
  }

  return {
    path: key.path,
    kind: "secret",
    optional: key.optional,
    ...(defaultValue !== undefined ? { default: defaultValue } : {}),
    ...(values !== undefined ? { values } : {})
  };
}

function providerFromTag(tagged: TaggedValue, env: V4Environment): ProviderRef {
  const baseOptions =
    env.env.defaultProvider?.name === tagged.tag ? env.env.defaultProvider.options : {};
  return providerRef({
    name: tagged.tag,
    options: {
      ...baseOptions,
      ...tagged.config
    }
  });
}

function providerRef(provider: ProviderConfig): ProviderRef {
  if (!SUPPORTED_PROVIDERS.has(provider.name)) {
    throw new Error(
      `Unsupported provider "${provider.name}". The v5 migrator can emit age, gcp, and sops providers.`
    );
  }
  return {
    name: provider.name as ProviderRef["name"],
    options: sortRecord(provider.options)
  };
}

function splitFallbackAndValues<T>(
  schemaFallback: T | undefined,
  envValues: Record<string, T>,
  envs: V4Environment[]
): { defaultValue?: T; values?: Record<string, T> } {
  const orderedEntries = Object.entries(envValues).sort(([a], [b]) => a.localeCompare(b));
  if (schemaFallback !== undefined) {
    const values = Object.fromEntries(
      orderedEntries.filter(([, value]) => !deepEqual(value, schemaFallback))
    ) as Record<string, T>;
    return {
      defaultValue: schemaFallback,
      values: Object.keys(values).length > 0 ? values : undefined
    };
  }

  if (orderedEntries.length === envs.length && orderedEntries.length > 0) {
    const first = orderedEntries[0][1];
    if (orderedEntries.every(([, value]) => deepEqual(value, first))) {
      return { defaultValue: first };
    }
  }

  return {
    values:
      orderedEntries.length > 0
        ? (Object.fromEntries(orderedEntries) as Record<string, T>)
        : undefined
  };
}

function toConfigScalar(value: unknown, label: string): ConfigScalar {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  throw new Error(`${label} is not a string, number, or boolean config value`);
}

function validatePaths(keys: NormalizedRecord[]): void {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key.path)) {
      throw new Error(`Duplicate flattened key path "${key.path}"`);
    }
    seen.add(key.path);
    for (const part of key.path.split("/")) {
      if (!V5_PATH_SEGMENT_RE.test(part)) {
        throw new Error(`${key.path}: invalid v5 path segment "${part}"`);
      }
    }
  }
}

function sortRecord(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)));
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
