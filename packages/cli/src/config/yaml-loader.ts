import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import { age, config as configRecord, gcp, secret, sops } from "./factories.js";
import type {
  AgeProviderOptions,
  BuiltinProviderRef,
  ConfigBinding,
  ConfigRecord,
  GcpProviderOptions,
  KeyshelfConfig,
  KeyTree,
  SecretRecord,
  SopsProviderOptions
} from "./types.js";

type KeyLeafValue = ConfigBinding | ConfigRecord | SecretRecord;

const ENV_DIR = ".keyshelf";

interface TaggedValue {
  tag: string;
  options: Record<string, unknown>;
}

interface ProviderConfig {
  name: string;
  options: Record<string, unknown>;
}

interface SchemaKey {
  path: string;
  isSecret: boolean;
  optional: boolean;
  defaultValue?: ConfigBinding;
}

interface ParsedSchema {
  name: string;
  keys: SchemaKey[];
  defaultProvider?: ProviderConfig;
}

interface EnvFile {
  name: string;
  defaultProvider?: ProviderConfig;
  overrides: Record<string, ConfigBinding | TaggedValue>;
}

const PROVIDER_TAGS = ["age", "gcp", "sops"] as const;
const ALL_TAGS = ["secret", ...PROVIDER_TAGS] as const;

function makeMappingTag(name: string): yaml.Type {
  return new yaml.Type(`!${name}`, {
    kind: "mapping",
    construct(data: Record<string, unknown> | null): TaggedValue {
      return { tag: name, options: data ?? {} };
    }
  });
}

function makeBareTag(name: string): yaml.Type {
  return new yaml.Type(`!${name}`, {
    kind: "scalar",
    construct(): TaggedValue {
      return { tag: name, options: {} };
    }
  });
}

// js-yaml v4: `load` IS the safe loader (the unsafe path was removed). We
// extend DEFAULT_SCHEMA only with our own keyshelf tags, so no `!!js/*`
// constructors are reachable from user content.
const KEYSHELF_SCHEMA = yaml.DEFAULT_SCHEMA.extend([
  ...ALL_TAGS.map(makeBareTag),
  ...ALL_TAGS.map(makeMappingTag)
]);

function safeYamlLoad(content: string): unknown {
  return yaml.load(content, { schema: KEYSHELF_SCHEMA });
}

function isTaggedValue(value: unknown): value is TaggedValue {
  return (
    typeof value === "object" &&
    value !== null &&
    "tag" in value &&
    "options" in value &&
    typeof (value as TaggedValue).tag === "string"
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function loadYamlConfig(schemaPath: string): Promise<KeyshelfConfig> {
  const rootDir = join(schemaPath, "..");
  const schema = parseSchema(await readFile(schemaPath, "utf-8"));
  const envs = await loadEnvironments(rootDir);

  if (envs.length === 0) {
    throw new Error(
      `keyshelf.yaml requires at least one environment file in ${join(rootDir, ENV_DIR)}/`
    );
  }

  return buildConfig(schema, envs);
}

function parseSchema(content: string): ParsedSchema {
  const raw = safeYamlLoad(content);
  if (!isPlainObject(raw)) {
    throw new Error('keyshelf.yaml must contain a "keys:" block defining your keys');
  }

  if (!isPlainObject(raw.keys)) {
    throw new Error('keyshelf.yaml must contain a "keys:" block defining your keys');
  }

  if (typeof raw.name !== "string" || raw.name === "") {
    throw new Error('keyshelf.yaml requires a top-level "name" string');
  }

  const flat = flattenKeys(raw.keys);
  const keys = Object.entries(flat).map(([path, value]) => toSchemaKey(path, value));

  return {
    name: raw.name,
    keys,
    defaultProvider: parseProviderBlock(raw["default-provider"])
  };
}

function toSchemaKey(path: string, value: unknown): SchemaKey {
  if (isTaggedValue(value)) {
    if (value.tag !== "secret") {
      throw new Error(
        `${path}: schema may only declare \`!secret\` tags; provider tags belong in env files`
      );
    }
    return {
      path,
      isSecret: true,
      optional: value.options.optional === true
    };
  }
  if (value != null && typeof value === "object") {
    throw new Error(`${path}: unexpected object value in schema; use nested keys or a tag`);
  }
  return {
    path,
    isSecret: false,
    optional: false,
    defaultValue: value == null ? undefined : toConfigScalar(value, path)
  };
}

function parseEnvFile(name: string, content: string): EnvFile {
  const doc = parseEnvDoc(name, content);
  return {
    name,
    defaultProvider: parseProviderBlock(doc["default-provider"]),
    overrides: parseEnvOverrides(name, doc.keys)
  };
}

function parseEnvDoc(name: string, content: string): Record<string, unknown> {
  const raw = safeYamlLoad(content);
  if (raw == null) return {};
  if (!isPlainObject(raw)) {
    throw new Error(`${ENV_DIR}/${name}.yaml must be a mapping`);
  }
  return raw;
}

function parseEnvOverrides(
  name: string,
  keysBlock: unknown
): Record<string, ConfigBinding | TaggedValue> {
  if (keysBlock == null) return {};
  if (!isPlainObject(keysBlock)) {
    throw new Error(`${ENV_DIR}/${name}.yaml: "keys" must be a mapping`);
  }

  const overrides: Record<string, ConfigBinding | TaggedValue> = {};
  for (const [path, value] of Object.entries(flattenKeys(keysBlock))) {
    if (value == null) continue;
    overrides[path] = isTaggedValue(value) ? value : toConfigScalar(value, `${name}:${path}`);
  }
  return overrides;
}

function parseProviderBlock(raw: unknown): ProviderConfig | undefined {
  if (!isPlainObject(raw)) return undefined;
  const name = raw.name;
  if (typeof name !== "string") return undefined;

  const options: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key !== "name") options[key] = value;
  }
  return { name, options };
}

async function loadEnvironments(rootDir: string): Promise<EnvFile[]> {
  const envDir = join(rootDir, ENV_DIR);
  if (!existsSync(envDir)) {
    throw new Error(`keyshelf.yaml requires a ${ENV_DIR}/ directory with one yaml file per env`);
  }

  const fileNames = (await readdir(envDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  return await Promise.all(
    fileNames.map(async (fileName) => {
      const name = fileName.slice(0, -".yaml".length);
      const content = await readFile(join(envDir, fileName), "utf-8");
      return parseEnvFile(name, content);
    })
  );
}

function flattenKeys(input: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const path = prefix ? `${prefix}/${key}` : key;
    if (isPlainObject(value) && !isTaggedValue(value)) {
      Object.assign(result, flattenKeys(value, path));
    } else {
      result[path] = value;
    }
  }
  return result;
}

function toConfigScalar(value: unknown, label: string): ConfigBinding {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  throw new Error(`${label}: not a string, number, or boolean`);
}

function buildConfig(schema: ParsedSchema, envs: EnvFile[]): KeyshelfConfig {
  const envNames = envs.map((env) => env.name);
  if (envNames.length === 0) {
    throw new Error("keyshelf.yaml requires at least one environment");
  }

  const keyTree: Record<string, KeyLeafValue> = {};
  for (const key of schema.keys) {
    keyTree[key.path] = key.isSecret
      ? buildSecretRecord(key, envs, schema.defaultProvider)
      : buildConfigRecord(key, envs);
  }

  return {
    __kind: "keyshelf:config",
    name: schema.name,
    envs: envNames,
    keys: keyTree as KeyTree
  };
}

function buildConfigRecord(
  key: SchemaKey,
  envs: EnvFile[]
): ReturnType<typeof configRecord> | ConfigBinding {
  const values: Record<string, ConfigBinding> = {};
  for (const env of envs) {
    const override = env.overrides[key.path];
    if (override === undefined) continue;
    if (isTaggedValue(override)) {
      throw new Error(
        `${env.name}:${key.path}: provider tag on a config key (declare it as \`!secret\` in keyshelf.yaml)`
      );
    }
    values[env.name] = override;
  }

  if (key.defaultValue !== undefined && Object.keys(values).length === 0) {
    return key.defaultValue;
  }

  return configRecord({
    ...(key.defaultValue !== undefined ? { default: key.defaultValue } : {}),
    ...(Object.keys(values).length > 0 ? { values } : {})
  });
}

function buildSecretRecord(
  key: SchemaKey,
  envs: EnvFile[],
  schemaDefault: ProviderConfig | undefined
): ReturnType<typeof secret> {
  const values: Record<string, BuiltinProviderRef> = {};
  for (const env of envs) {
    const provider = resolveSecretProvider(key, env, schemaDefault);
    if (provider !== undefined) values[env.name] = provider;
  }

  return secret({
    ...(key.optional ? { optional: true } : {}),
    ...(Object.keys(values).length > 0 ? { values } : {})
  });
}

function resolveSecretProvider(
  key: SchemaKey,
  env: EnvFile,
  schemaDefault: ProviderConfig | undefined
): BuiltinProviderRef | undefined {
  const override = env.overrides[key.path];

  if (override !== undefined && !isTaggedValue(override)) {
    throw new Error(
      `${env.name}:${key.path}: secret keys require a provider tag, got a plain value`
    );
  }

  const fallbackProvider = env.defaultProvider ?? schemaDefault;

  if (override !== undefined) {
    const tagOptions = mergeProviderOptions(override, fallbackProvider);
    return providerRef(override.tag, tagOptions, `${env.name}:${key.path}`);
  }

  if (fallbackProvider !== undefined) {
    return providerRef(fallbackProvider.name, fallbackProvider.options, `${env.name}:${key.path}`);
  }

  return undefined;
}

function mergeProviderOptions(
  tagged: TaggedValue,
  fallback: ProviderConfig | undefined
): Record<string, unknown> {
  if (fallback === undefined || fallback.name !== tagged.tag) return tagged.options;
  return { ...fallback.options, ...tagged.options };
}

function providerRef(
  name: string,
  options: Record<string, unknown>,
  label: string
): BuiltinProviderRef {
  switch (name) {
    case "age":
      return age(
        requireOptions<AgeProviderOptions>(options, ["identityFile", "secretsDir"], label, "age")
      );
    case "gcp":
      return gcp(requireOptions<GcpProviderOptions>(options, ["project"], label, "gcp"));
    case "sops":
      return sops(
        requireOptions<SopsProviderOptions>(options, ["identityFile", "secretsFile"], label, "sops")
      );
    default:
      throw new Error(`${label}: unknown provider "${name}"`);
  }
}

function requireOptions<T>(
  options: Record<string, unknown>,
  required: readonly string[],
  label: string,
  providerName: string
): T {
  for (const field of required) {
    if (typeof options[field] !== "string" || options[field] === "") {
      throw new Error(`${label}: ${providerName} provider requires "${field}"`);
    }
  }
  return options as T;
}
