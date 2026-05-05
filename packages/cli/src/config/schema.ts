import { z } from "zod";
import { isTemplateMapping, type AppMapping } from "./app-mapping.js";
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
const CONFIG_NAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const configScalarSchema = z.union([z.string(), z.number(), z.boolean()]);

const ageProviderSchema = z
  .object({
    __kind: z.literal("provider:age"),
    name: z.literal("age"),
    options: z
      .object({
        identityFile: z.string().min(1),
        secretsDir: z.string().min(1)
      })
      .strict()
  })
  .strict();

const gcpProviderSchema = z
  .object({
    __kind: z.literal("provider:gcp"),
    name: z.literal("gcp"),
    options: z
      .object({
        project: z.string().min(1)
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
        identityFile: z.string().min(1),
        secretsFile: z.string().min(1)
      })
      .strict()
  })
  .strict();

const providerRefSchema = z.discriminatedUnion("__kind", [
  ageProviderSchema,
  gcpProviderSchema,
  sopsProviderSchema
]);

const movedFromSchema = z
  .union([z.string().min(1), z.array(z.string().min(1)).nonempty()])
  .optional();

const baseRecordSchema = {
  group: z.string().optional(),
  optional: z.boolean().optional(),
  description: z.string().optional(),
  movedFrom: movedFromSchema
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

interface TemplateVisitState {
  visiting: Set<string>;
  visited: Set<string>;
  stack: string[];
}

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
    name: z
      .string()
      .min(1)
      .refine((value) => CONFIG_NAME_RE.test(value), {
        message:
          "name must match /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/ (lowercase, digits, dashes; no leading or trailing dash)"
      }),
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

  const flattened = flattenKeyTree(parsed.keys, errors);
  const paths = new Set(flattened.map((record) => record.path));

  validatePathConflicts(flattened, errors);
  validateRecords(flattened, parsed.envs, groups, errors);
  validateMovedFrom(flattened, paths, errors);
  validateTemplateReferences(flattened, paths, errors);

  if (errors.length > 0) {
    throw new Error(
      `Invalid keyshelf.config.ts:\n${errors.map((error) => `- ${error}`).join("\n")}`
    );
  }

  return {
    name: parsed.name,
    envs: [...parsed.envs],
    groups,
    keys: flattened
  };
}

export function validateAppMappingReferences(
  mappings: AppMapping[],
  flattenedKeys: NormalizedRecord[]
): void {
  const paths = new Set(flattenedKeys.map((record) => record.path));
  const errors: string[] = [];

  for (const mapping of mappings) {
    const references = isTemplateMapping(mapping) ? mapping.keyPaths : [mapping.keyPath];
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

function validateRecords(
  records: NormalizedRecord[],
  envs: readonly string[],
  groups: readonly string[],
  errors: string[]
): void {
  const envSet = new Set(envs);
  const groupSet = new Set(groups);

  for (const record of records) {
    validateRecordGroup(record, groups, groupSet, errors);
    validateRecordValues(record, envSet, errors);
    validateSecretValue(record, errors);
  }
}

function validateRecordGroup(
  record: NormalizedRecord,
  groups: readonly string[],
  groupSet: Set<string>,
  errors: string[]
): void {
  if (record.group === undefined || groupSet.has(record.group)) return;

  const suffix = groups.length === 0 ? " because no groups are declared" : "";
  errors.push(`${record.path}: group "${record.group}" is not declared${suffix}`);
}

function validateRecordValues(
  record: NormalizedRecord,
  envSet: Set<string>,
  errors: string[]
): void {
  for (const envName of Object.keys(record.values ?? {})) {
    if (!envSet.has(envName)) {
      errors.push(`${record.path}: values contains undeclared env "${envName}"`);
    }
  }
}

function validateSecretValue(record: NormalizedRecord, errors: string[]): void {
  if (record.kind !== "secret") return;

  const hasValues = record.values !== undefined && Object.keys(record.values).length > 0;
  if (record.value === undefined && !hasValues) {
    errors.push(`${record.path}: secret requires value, default, or at least one values entry`);
  }
}

function flattenKeyTree(
  tree: KeyTree,
  errors: string[],
  prefix: string[] = []
): NormalizedRecord[] {
  const records: NormalizedRecord[] = [];

  for (const [rawKey, value] of Object.entries(tree)) {
    const fullParts = [...prefix, ...rawKey.split("/")];
    const path = fullParts.join("/");

    validatePathParts(fullParts, errors);
    records.push(...flattenKeyNode(value, path, fullParts, errors));
  }

  return records;
}

function flattenKeyNode(
  value: KeyNode,
  path: string,
  fullParts: string[],
  errors: string[]
): NormalizedRecord[] {
  if (isConfigRecord(value)) return [normalizeConfigRecord(path, value, errors)];
  if (isSecretRecord(value)) return [normalizeSecretRecord(path, value, errors)];

  const scalar = configScalarSchema.safeParse(value);
  if (scalar.success) return [normalizeScalarRecord(path, scalar.data)];

  return flattenKeyTree(value as KeyTree, errors, fullParts);
}

function normalizeConfigRecord(
  path: string,
  input: ConfigRecord,
  errors: string[]
): NormalizedRecord {
  return {
    path,
    kind: "config",
    group: input.group,
    optional: input.optional ?? false,
    description: input.description,
    movedFrom: normalizeMovedFrom(input.movedFrom),
    value: resolveBinding(path, input.value, input.default, errors),
    values: copyDefinedRecord(input.values)
  };
}

function normalizeSecretRecord(
  path: string,
  input: SecretRecord,
  errors: string[]
): NormalizedRecord {
  return {
    path,
    kind: "secret",
    group: input.group,
    optional: input.optional ?? false,
    description: input.description,
    movedFrom: normalizeMovedFrom(input.movedFrom),
    value: resolveBinding(path, input.value, input.default, errors),
    values: copyDefinedRecord(input.values)
  };
}

function normalizeMovedFrom(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? [...value] : [value];
}

function resolveBinding<T>(
  path: string,
  value: T | undefined,
  fallback: T | undefined,
  errors: string[]
): T | undefined {
  if (value !== undefined && fallback !== undefined) {
    errors.push(`${path}: value and default are mutually exclusive`);
  }
  return value ?? fallback;
}

function normalizeScalarRecord(path: string, value: ConfigBinding): NormalizedRecord {
  return {
    path,
    kind: "config",
    optional: false,
    value
  };
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

function validateMovedFrom(
  records: NormalizedRecord[],
  paths: Set<string>,
  errors: string[]
): void {
  for (const record of records) {
    if (record.movedFrom === undefined) continue;
    for (const from of record.movedFrom) {
      if (from === record.path) {
        errors.push(`${record.path}: movedFrom cannot reference itself`);
        continue;
      }
      if (paths.has(from)) {
        errors.push(`${record.path}: movedFrom "${from}" collides with a declared key path`);
      }
    }
  }
}

function validateTemplateReferences(
  records: NormalizedRecord[],
  paths: Set<string>,
  errors: string[]
): void {
  const graph = buildTemplateGraph(records, paths, errors);
  validateTemplateGraph(graph, errors);
}

function buildTemplateGraph(
  records: NormalizedRecord[],
  paths: Set<string>,
  errors: string[]
): Map<string, string[]> {
  const graph = new Map<string, string[]>();

  for (const record of records) {
    if (record.kind !== "config") continue;
    graph.set(record.path, validateTemplateRecord(record, paths, errors));
  }

  return graph;
}

function validateTemplateRecord(
  record: Extract<NormalizedRecord, { kind: "config" }>,
  paths: Set<string>,
  errors: string[]
): string[] {
  const references = getTemplateReferences(record);

  for (const reference of references) {
    if (!paths.has(reference)) {
      errors.push(`${record.path}: template references unknown key "${reference}"`);
    }
  }

  return references.filter((reference) => paths.has(reference));
}

function getTemplateReferences(record: Extract<NormalizedRecord, { kind: "config" }>): string[] {
  return [
    ...extractTemplateReferences(record.value),
    ...Object.values(record.values ?? {}).flatMap((value) => extractTemplateReferences(value))
  ];
}

function validateTemplateGraph(graph: Map<string, string[]>, errors: string[]): void {
  const state: TemplateVisitState = {
    visiting: new Set<string>(),
    visited: new Set<string>(),
    stack: []
  };

  for (const path of graph.keys()) {
    visitTemplatePath(path, graph, state, errors);
  }
}

function visitTemplatePath(
  path: string,
  graph: Map<string, string[]>,
  state: TemplateVisitState,
  errors: string[]
): void {
  if (state.visited.has(path)) return;
  if (state.visiting.has(path)) {
    reportTemplateCycle(path, state.stack, errors);
    return;
  }

  state.visiting.add(path);
  state.stack.push(path);
  for (const dependency of graph.get(path) ?? []) {
    visitTemplatePath(dependency, graph, state, errors);
  }
  state.stack.pop();
  state.visiting.delete(path);
  state.visited.add(path);
}

function reportTemplateCycle(path: string, stack: string[], errors: string[]): void {
  const cycleStart = stack.indexOf(path);
  const cycle = [...stack.slice(cycleStart), path].join(" -> ");
  errors.push(`template cycle detected: ${cycle}`);
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

function copyDefinedRecord<T>(
  values: Partial<Record<string, T>> | undefined
): Record<string, T> | undefined {
  if (values === undefined) return undefined;

  const copy: Record<string, T> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      copy[key] = value;
    }
  }
  return copy;
}

function isConfigRecord(value: unknown): value is ConfigRecord {
  return getKind(value) === "config";
}

function isSecretRecord(value: unknown): value is SecretRecord {
  return getKind(value) === "secret";
}

export function isProviderRef(value: unknown): value is BuiltinProviderRef {
  const kind = getKind(value);
  return typeof kind === "string" && kind.startsWith("provider:");
}

function getKind(value: unknown): unknown {
  if (value == null) return undefined;
  if (typeof value !== "object") return undefined;
  if (Array.isArray(value)) return undefined;

  return (value as { __kind?: unknown }).__kind;
}
