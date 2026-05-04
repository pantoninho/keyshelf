import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import yaml from "js-yaml";

const SCHEMA_FILE = "keyshelf.yaml";
const ENV_DIR = ".keyshelf";
const APP_MAPPING_FILE = ".env.keyshelf";

export interface TaggedValue {
  tag: string;
  config: Record<string, unknown>;
}

export interface ProviderConfig {
  name: string;
  options: Record<string, unknown>;
}

export interface KeyDefinition {
  path: string;
  isSecret: boolean;
  optional: boolean;
  defaultValue?: string;
}

export interface EnvConfig {
  defaultProvider?: ProviderConfig;
  overrides: Record<string, string | TaggedValue>;
}

export interface AppMapping {
  envVar: string;
  keyPath?: string;
  template?: string;
  keyPaths?: string[];
}

export interface V4Environment {
  name: string;
  filePath: string;
  env: EnvConfig;
}

export interface V4Project {
  rootDir: string;
  name?: string;
  schema: KeyDefinition[];
  envs: V4Environment[];
  appMapping: AppMapping[];
}

interface ParsedSchema {
  keys: KeyDefinition[];
  config: {
    name?: string;
    provider?: ProviderConfig;
  };
}

const TAG_NAMES = ["secret", "gcp", "aws", "age", "sops"] as const;
const TEMPLATE_RE = /\$\{([^}]+)\}/g;

function createTagType(tagName: string): yaml.Type {
  return new yaml.Type(`!${tagName}`, {
    kind: "mapping",
    construct(data: Record<string, unknown> | null): TaggedValue {
      return { tag: tagName, config: data ?? {} };
    },
    instanceOf: Object,
    represent(value: unknown) {
      return (value as TaggedValue).config;
    }
  });
}

function createBareTagType(tagName: string): yaml.Type {
  return new yaml.Type(`!${tagName}`, {
    kind: "scalar",
    construct(): TaggedValue {
      return { tag: tagName, config: {} };
    },
    instanceOf: Object,
    represent() {
      return "";
    }
  });
}

const mappingTypes = TAG_NAMES.map((name) => createTagType(name));
const bareTypes = TAG_NAMES.map((name) => createBareTagType(name));
const KEYSHELF_SCHEMA = yaml.DEFAULT_SCHEMA.extend([...bareTypes, ...mappingTypes]);

export async function loadV4Project(cwd: string): Promise<V4Project> {
  const rootDir = resolve(cwd);
  const schemaPath = join(rootDir, SCHEMA_FILE);
  if (!existsSync(schemaPath)) {
    throw new Error(`Could not find ${SCHEMA_FILE} in ${rootDir}`);
  }

  const parsed = parseSchema(await readFile(schemaPath, "utf-8"));
  const envs = await loadEnvironments(rootDir, parsed.config.provider);
  const appMapping = await loadAppMapping(rootDir);

  return {
    rootDir,
    name: parsed.config.name,
    schema: parsed.keys,
    envs,
    appMapping
  };
}

function parseSchemaDoc(content: string): Record<string, unknown> {
  const raw = yaml.load(content, { schema: KEYSHELF_SCHEMA });
  if (!raw || typeof raw !== "object") {
    throw new Error('keyshelf.yaml must contain a "keys:" block defining your keys');
  }

  const doc = raw as Record<string, unknown>;
  if (!("keys" in doc) || doc.keys == null || typeof doc.keys !== "object") {
    throw new Error('keyshelf.yaml must contain a "keys:" block defining your keys');
  }
  return doc;
}

const SCHEMA_NAME_RE = /^[a-zA-Z0-9_-]+$/;

function extractSchemaName(doc: Record<string, unknown>): string | undefined {
  const value = doc.name;
  if (value === undefined) return undefined;
  return validateSchemaName(value);
}

function validateSchemaName(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error('keyshelf.yaml "name" must be a non-empty string');
  }
  if (value === "") {
    throw new Error('keyshelf.yaml "name" must be a non-empty string');
  }
  if (!SCHEMA_NAME_RE.test(value)) {
    throw new Error(
      'keyshelf.yaml "name" must contain only letters, digits, hyphens, and underscores'
    );
  }
  return value;
}

function toKeyDefinition(path: string, value: unknown): KeyDefinition {
  if (isTaggedValue(value)) {
    return {
      path,
      isSecret: true,
      optional: value.tag === "secret" && value.config.optional === true
    };
  }
  if (value != null && typeof value === "object") {
    throw new Error(
      `Unexpected object value at "${path}" in schema. Use nested keys or a tag instead.`
    );
  }
  return {
    path,
    isSecret: false,
    optional: false,
    defaultValue: value == null ? undefined : String(value)
  };
}

function parseSchema(content: string): ParsedSchema {
  const doc = parseSchemaDoc(content);
  const provider = parseProviderBlock(doc["default-provider"]);
  const name = extractSchemaName(doc);
  const flat = flattenKeys(doc.keys as Record<string, unknown>);
  const definitions = Object.entries(flat).map(([path, value]) => toKeyDefinition(path, value));
  return { keys: definitions, config: { name, provider } };
}

function parseEnvironment(content: string): EnvConfig {
  const raw = yaml.load(content, { schema: KEYSHELF_SCHEMA });
  if (!raw || typeof raw !== "object") {
    return { overrides: {} };
  }

  const doc = raw as Record<string, unknown>;
  const defaultProvider = parseProviderBlock(doc["default-provider"]);

  const keysBlock = doc.keys;
  if (keysBlock != null && typeof keysBlock !== "object") {
    throw new Error('Environment file "keys:" must be a mapping');
  }

  const source = (keysBlock as Record<string, unknown> | undefined) ?? {};
  const flat = flattenKeys(source);
  const overrides: Record<string, string | TaggedValue> = {};

  for (const [path, value] of Object.entries(flat)) {
    if (value != null) {
      overrides[path] = value as string | TaggedValue;
    }
  }

  return { defaultProvider, overrides };
}

function parseProviderBlock(raw: unknown): ProviderConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;

  const block = raw as Record<string, unknown>;
  const name = block.name;
  if (typeof name !== "string") return undefined;

  const options: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(block)) {
    if (key !== "name") {
      options[key] = value;
    }
  }

  return { name, options };
}

function parseAppMapping(content: string): AppMapping[] {
  const mappings: AppMapping[] = [];

  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;

    const envVar = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();
    if (!envVar || !value) continue;

    TEMPLATE_RE.lastIndex = 0;
    if (TEMPLATE_RE.test(value)) {
      TEMPLATE_RE.lastIndex = 0;
      mappings.push({
        envVar,
        template: value,
        keyPaths: [...value.matchAll(TEMPLATE_RE)].map((match) => match[1].trim())
      });
      continue;
    }

    mappings.push({ envVar, keyPath: value });
  }

  return mappings;
}

export function isTaggedValue(value: unknown): value is TaggedValue {
  return (
    typeof value === "object" &&
    value !== null &&
    "tag" in value &&
    "config" in value &&
    typeof (value as TaggedValue).tag === "string"
  );
}

async function loadEnvironments(
  rootDir: string,
  globalProvider: ProviderConfig | undefined
): Promise<V4Environment[]> {
  const envDir = join(rootDir, ENV_DIR);
  if (!existsSync(envDir)) {
    throw new Error(`Could not find ${ENV_DIR}/ with v4 environment files in ${rootDir}`);
  }

  const entries = (await readdir(envDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  if (entries.length === 0) {
    throw new Error(`Could not find any ${ENV_DIR}/*.yaml environment files in ${rootDir}`);
  }

  return await Promise.all(
    entries.map(async (fileName) => {
      const filePath = join(envDir, fileName);
      const name = fileName.slice(0, -".yaml".length);
      return {
        name,
        filePath,
        env: mergeGlobalProvider(
          parseEnvironment(await readFile(filePath, "utf-8")),
          globalProvider
        )
      };
    })
  );
}

async function loadAppMapping(rootDir: string): Promise<AppMapping[]> {
  const mappingPath = join(rootDir, APP_MAPPING_FILE);
  try {
    return parseAppMapping(await readFile(mappingPath, "utf-8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

function mergeGlobalProvider(
  env: EnvConfig,
  globalProvider: ProviderConfig | undefined
): EnvConfig {
  if (globalProvider === undefined) return env;
  if (env.defaultProvider === undefined) {
    return { ...env, defaultProvider: globalProvider };
  }

  const envProvider = env.defaultProvider;
  return {
    ...env,
    defaultProvider: {
      name: envProvider.name,
      options: {
        ...(globalProvider.name === envProvider.name ? globalProvider.options : {}),
        ...envProvider.options
      }
    }
  };
}

function flattenKeys(input: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    const path = prefix ? `${prefix}/${key}` : key;
    if (isPlainObject(value) && !isTaggedValue(value)) {
      Object.assign(result, flattenKeys(value as Record<string, unknown>, path));
    } else {
      result[path] = value;
    }
  }

  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
