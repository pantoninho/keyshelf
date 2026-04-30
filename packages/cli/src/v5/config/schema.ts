import { z } from "zod";
import type {
  BuiltinProviderRef,
  ConfigBinding,
  ConfigRecord,
  KeyTree,
  KeyshelfConfig,
  NormalizedConfig,
  NormalizedRecord,
  SecretRecord
} from "./types.js";

const PATH_SEGMENT_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const TEMPLATE_RE = /(?<!\$)\$\{([^}]+)\}/g;

const configScalarSchema = z.union([z.string(), z.number(), z.boolean()]);

const ageProviderSchema = z
  .object({
    __kind: z.literal("provider:age"),
    name: z.literal("age"),
    options: z
      .object({
        identityFile: z.string().optional(),
        recipient: z.string().optional()
      })
      .strict()
      .refine((options) => options.identityFile !== undefined || options.recipient !== undefined, {
        message: "age provider requires identityFile or recipient"
      })
  })
  .strict();

const gcpProviderSchema = z
  .object({
    __kind: z.literal("provider:gcp"),
    name: z.literal("gcp"),
    options: z
      .object({
        project: z.string().min(1),
        secret: z.string().optional(),
        version: z.string().optional()
      })
      .strict()
  })
  .strict();

const sopsProviderSchema = z
  .object({
    __kind: z.literal("provider:sops"),
    name: z.literal("sops"),
    options: z
      .object({
        file: z.string().min(1),
        path: z.string().optional()
      })
      .strict()
  })
  .strict();

const providerRefSchema = z.discriminatedUnion("__kind", [
  ageProviderSchema,
  gcpProviderSchema,
  sopsProviderSchema
]);

const baseRecordSchema = {
  group: z.string().optional(),
  optional: z.boolean().optional(),
  description: z.string().optional()
};

const configRecordSchema = z
  .object({
    __kind: z.literal("config"),
    ...baseRecordSchema,
    value: configScalarSchema.optional(),
    default: configScalarSchema.optional(),
    values: z.record(z.string(), configScalarSchema).optional()
  })
  .strict();

const secretRecordSchema = z
  .object({
    __kind: z.literal("secret"),
    ...baseRecordSchema,
    value: providerRefSchema.optional(),
    default: providerRefSchema.optional(),
    values: z.record(z.string(), providerRefSchema).optional()
  })
  .strict();

interface KeyNamespace {
  [key: string]: KeyNode;
}

type KeyNode = ConfigBinding | ConfigRecord | SecretRecord | KeyNamespace;

const keyNodeSchema: z.ZodType<KeyNode> = z.lazy(() =>
  z.union([
    configScalarSchema,
    configRecordSchema,
    secretRecordSchema,
    z
      .record(z.string(), keyNodeSchema)
      .refine((value) => Object.keys(value).length > 0, {
        message: "key namespaces must not be empty"
      })
      .refine((value) => !Object.hasOwn(value, "__kind"), {
        message: "factory objects with __kind must match their declared schema"
      })
  ])
);

const keyshelfConfigSchema = z
  .object({
    __kind: z.literal("keyshelf:config"),
    envs: z.array(z.string().min(1)).nonempty(),
    groups: z.array(z.string().min(1)).optional(),
    keys: z.record(z.string(), keyNodeSchema).refine((value) => Object.keys(value).length > 0, {
      message: "keys must contain at least one entry"
    })
  })
  .strict();

export { keyshelfConfigSchema, providerRefSchema };

export function normalizeConfig(input: unknown): NormalizedConfig {
  const parsed = keyshelfConfigSchema.parse(input) as KeyshelfConfig;
  const errors: string[] = [];

  checkUnique("envs", parsed.envs, errors);
  const groups = [...(parsed.groups ?? [])];
  checkUnique("groups", groups, errors);

  const envSet = new Set(parsed.envs);
  const groupSet = new Set(groups);
  const flattened = flattenKeyTree(parsed.keys, errors);
  const paths = new Set(flattened.map((record) => record.path));

  validatePathConflicts(flattened, errors);

  for (const record of flattened) {
    if (record.value !== undefined && record.default !== undefined) {
      errors.push(`${record.path}: value and default are mutually exclusive`);
    }

    if (record.group !== undefined && !groupSet.has(record.group)) {
      const suffix = groups.length === 0 ? " because no groups are declared" : "";
      errors.push(`${record.path}: group "${record.group}" is not declared${suffix}`);
    }

    for (const envName of Object.keys(record.values ?? {})) {
      if (!envSet.has(envName)) {
        errors.push(`${record.path}: values contains undeclared env "${envName}"`);
      }
    }

    if (record.kind === "secret") {
      const hasValues = record.values !== undefined && Object.keys(record.values).length > 0;
      if (record.value === undefined && record.default === undefined && !hasValues) {
        errors.push(`${record.path}: secret requires value, default, or at least one values entry`);
      }
    }
  }

  validateTemplateReferences(flattened, paths, errors);

  if (errors.length > 0) {
    throw new Error(`Invalid keyshelf.config.ts:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }

  return {
    envs: [...parsed.envs],
    groups,
    keys: flattened
  };
}

export function validateAppMappingReferences(
  mappings: Array<{ envVar: string; keyPath?: string; keyPaths?: string[] }>,
  flattenedKeys: NormalizedRecord[]
): void {
  const paths = new Set(flattenedKeys.map((record) => record.path));
  const errors: string[] = [];

  for (const mapping of mappings) {
    const references = mapping.keyPaths ?? (mapping.keyPath !== undefined ? [mapping.keyPath] : []);
    for (const reference of references) {
      if (!paths.has(reference)) {
        errors.push(`${mapping.envVar}: references unknown key "${reference}"`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid .env.keyshelf:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
}

function flattenKeyTree(tree: KeyTree, errors: string[], prefix: string[] = []): NormalizedRecord[] {
  const records: NormalizedRecord[] = [];
  const seen = new Set<string>();

  for (const [rawKey, value] of Object.entries(tree)) {
    const keyParts = rawKey.split("/");
    const fullParts = [...prefix, ...keyParts];
    const path = fullParts.join("/");

    if (seen.has(path)) {
      errors.push(`${path}: duplicate flattened path`);
      continue;
    }
    seen.add(path);

    validatePathParts(fullParts, errors);

    if (isConfigRecord(value)) {
      records.push({
        path,
        kind: "config",
        group: value.group,
        optional: value.optional ?? false,
        description: value.description,
        value: value.value,
        default: value.default,
        values: copyDefinedRecord(value.values)
      });
      continue;
    }

    if (isSecretRecord(value)) {
      records.push({
        path,
        kind: "secret",
        group: value.group,
        optional: value.optional ?? false,
        description: value.description,
        value: value.value,
        default: value.default,
        values: copyDefinedRecord(value.values)
      });
      continue;
    }

    if (isScalar(value)) {
      records.push({
        path,
        kind: "config",
        optional: false,
        value
      });
      continue;
    }

    if (value == null || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${path}: expected scalar, config(...), secret(...), or namespace object`);
      continue;
    }

    records.push(...flattenKeyTree(value as KeyTree, errors, fullParts));
  }

  return records;
}

function validatePathParts(parts: string[], errors: string[]): void {
  for (const part of parts) {
    if (!PATH_SEGMENT_RE.test(part)) {
      errors.push(`${parts.join("/")}: invalid path segment "${part}"`);
    }
  }
}

function validatePathConflicts(records: NormalizedRecord[], errors: string[]): void {
  const sorted = [...records].sort((a, b) => a.path.localeCompare(b.path));
  const seen = new Set<string>();

  for (const record of sorted) {
    if (seen.has(record.path)) {
      errors.push(`${record.path}: duplicate flattened path`);
      continue;
    }
    seen.add(record.path);

    const segments = record.path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      const prefix = segments.slice(0, index).join("/");
      if (seen.has(prefix)) {
        errors.push(`${record.path}: conflicts with leaf path "${prefix}"`);
      }
    }
  }
}

function validateTemplateReferences(
  records: NormalizedRecord[],
  paths: Set<string>,
  errors: string[]
): void {
  const graph = new Map<string, string[]>();

  for (const record of records) {
    if (record.kind !== "config") continue;

    const references = [
      ...extractTemplateReferences(record.value),
      ...extractTemplateReferences(record.default),
      ...Object.values(record.values ?? {}).flatMap((value) => extractTemplateReferences(value))
    ];

    for (const reference of references) {
      if (!paths.has(reference)) {
        errors.push(`${record.path}: template references unknown key "${reference}"`);
      }
    }

    graph.set(record.path, references.filter((reference) => paths.has(reference)));
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (path: string): void => {
    if (visited.has(path)) return;
    if (visiting.has(path)) {
      const cycleStart = stack.indexOf(path);
      const cycle = [...stack.slice(cycleStart), path].join(" -> ");
      errors.push(`template cycle detected: ${cycle}`);
      return;
    }

    visiting.add(path);
    stack.push(path);
    for (const dependency of graph.get(path) ?? []) {
      visit(dependency);
    }
    stack.pop();
    visiting.delete(path);
    visited.add(path);
  };

  for (const path of graph.keys()) {
    visit(path);
  }
}

function extractTemplateReferences(value: unknown): string[] {
  if (typeof value !== "string") return [];

  const references: string[] = [];
  TEMPLATE_RE.lastIndex = 0;
  for (const match of value.matchAll(TEMPLATE_RE)) {
    references.push(match[1].trim());
  }
  return references;
}

function checkUnique(label: string, values: readonly string[], errors: string[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      errors.push(`${label}: duplicate "${value}"`);
    }
    seen.add(value);
  }
}

function copyDefinedRecord<T>(values: Partial<Record<string, T>> | undefined): Record<string, T> | undefined {
  if (values === undefined) return undefined;

  const copy: Record<string, T> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      copy[key] = value;
    }
  }
  return copy;
}

function isScalar(value: unknown): value is ConfigBinding {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isConfigRecord(value: unknown): value is ConfigRecord {
  return (
    value != null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { __kind?: unknown }).__kind === "config"
  );
}

function isSecretRecord(value: unknown): value is SecretRecord {
  return (
    value != null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { __kind?: unknown }).__kind === "secret"
  );
}

export function isProviderRef(value: unknown): value is BuiltinProviderRef {
  return (
    value != null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { __kind?: unknown }).__kind === "string" &&
    (value as { __kind: string }).__kind.startsWith("provider:")
  );
}
