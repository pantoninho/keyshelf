#!/usr/bin/env node
import { mkdir, writeFile, chmod, readFile } from 'fs/promises';
import { dirname, resolve, join, isAbsolute } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';
import { createJiti } from 'jiti';
import { z } from 'zod';
import { homedir } from 'os';

// ../cli/dist/src/config/app-mapping.js
var TEMPLATE_RE = /\$\{([^}]+)\}/g;
function isTemplateMapping(m) {
  return "template" in m;
}
function* iterDotEnvEntries(content) {
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();
    if (!key) continue;
    yield { key, value };
  }
}
function parseAppMapping(content) {
  const mappings = [];
  for (const { key: envVar, value } of iterDotEnvEntries(content)) {
    if (!value) continue;
    if (TEMPLATE_RE.test(value)) {
      TEMPLATE_RE.lastIndex = 0;
      const keyPaths = [...value.matchAll(TEMPLATE_RE)].map((m) => m[1].trim());
      mappings.push({ envVar, template: value, keyPaths });
    } else {
      mappings.push({ envVar, keyPath: value });
    }
  }
  return mappings;
}
var PATH_SEGMENT_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;
var TEMPLATE_RE2 = /(?<!\$)\$\{([^}]+)\}/g;
var CONFIG_NAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
var configScalarSchema = z.union([z.string(), z.number(), z.boolean()]);
var ageProviderSchema = z.object({
  __kind: z.literal("provider:age"),
  name: z.literal("age"),
  options: z.object({
    identityFile: z.string().min(1),
    secretsDir: z.string().min(1)
  }).strict()
}).strict();
var gcpProviderSchema = z.object({
  __kind: z.literal("provider:gcp"),
  name: z.literal("gcp"),
  options: z.object({
    project: z.string().min(1)
  }).strict()
}).strict();
var sopsProviderSchema = z.object({
  __kind: z.literal("provider:sops"),
  name: z.literal("sops"),
  options: z.object({
    identityFile: z.string().min(1),
    secretsFile: z.string().min(1)
  }).strict()
}).strict();
var providerRefSchema = z.discriminatedUnion("__kind", [
  ageProviderSchema,
  gcpProviderSchema,
  sopsProviderSchema
]);
var movedFromSchema = z.union([z.string().min(1), z.array(z.string().min(1)).nonempty()]).optional();
var baseRecordSchema = {
  group: z.string().optional(),
  optional: z.boolean().optional(),
  description: z.string().optional(),
  movedFrom: movedFromSchema
};
var configRecordSchema = z.object({
  __kind: z.literal("config"),
  ...baseRecordSchema,
  value: configScalarSchema.optional(),
  default: configScalarSchema.optional(),
  values: z.record(z.string(), configScalarSchema).optional()
}).strict();
var secretRecordSchema = z.object({
  __kind: z.literal("secret"),
  ...baseRecordSchema,
  value: providerRefSchema.optional(),
  default: providerRefSchema.optional(),
  values: z.record(z.string(), providerRefSchema).optional()
}).strict();
var keyNodeSchema = z.lazy(
  () => z.union([
    configScalarSchema,
    configRecordSchema,
    secretRecordSchema,
    z.record(z.string(), keyNodeSchema).refine((value) => Object.keys(value).length > 0, {
      message: "key namespaces must not be empty"
    }).refine((value) => !Object.hasOwn(value, "__kind"), {
      message: "factory objects with __kind must match their declared schema"
    })
  ])
);
var keyshelfConfigSchema = z.object({
  __kind: z.literal("keyshelf:config"),
  name: z.string().min(1).refine((value) => CONFIG_NAME_RE.test(value), {
    message: "name must match /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/ (lowercase, digits, dashes; no leading or trailing dash)"
  }),
  envs: z.array(z.string().min(1)).nonempty(),
  groups: z.array(z.string().min(1)).optional(),
  keys: z.record(z.string(), keyNodeSchema).refine((value) => Object.keys(value).length > 0, {
    message: "keys must contain at least one entry"
  })
}).strict();
function normalizeConfig(input) {
  const parsed = keyshelfConfigSchema.parse(input);
  const errors = [];
  checkUnique("envs", parsed.envs, errors);
  const groups = [...parsed.groups ?? []];
  checkUnique("groups", groups, errors);
  const flattened = flattenKeyTree(parsed.keys, errors);
  const paths = new Set(flattened.map((record) => record.path));
  validatePathConflicts(flattened, errors);
  validateRecords(flattened, parsed.envs, groups, errors);
  validateMovedFrom(flattened, paths, errors);
  validateTemplateReferences(flattened, paths, errors);
  if (errors.length > 0) {
    throw new Error(
      `Invalid keyshelf.config.ts:
${errors.map((error) => `- ${error}`).join("\n")}`
    );
  }
  return {
    name: parsed.name,
    envs: [...parsed.envs],
    groups,
    keys: flattened
  };
}
function validateAppMappingReferences(mappings, flattenedKeys) {
  const paths = new Set(flattenedKeys.map((record) => record.path));
  const errors = [];
  for (const mapping of mappings) {
    const references = isTemplateMapping(mapping) ? mapping.keyPaths : [mapping.keyPath];
    for (const reference of references) {
      if (!paths.has(reference)) {
        errors.push(`${mapping.envVar}: references unknown key "${reference}"`);
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(`Invalid .env.keyshelf:
${errors.map((error) => `- ${error}`).join("\n")}`);
  }
}
function validateRecords(records, envs, groups, errors) {
  const envSet = new Set(envs);
  const groupSet = new Set(groups);
  for (const record of records) {
    validateRecordGroup(record, groups, groupSet, errors);
    validateRecordValues(record, envSet, errors);
    validateSecretValue(record, errors);
  }
}
function validateRecordGroup(record, groups, groupSet, errors) {
  if (record.group === void 0 || groupSet.has(record.group)) return;
  const suffix = groups.length === 0 ? " because no groups are declared" : "";
  errors.push(`${record.path}: group "${record.group}" is not declared${suffix}`);
}
function validateRecordValues(record, envSet, errors) {
  for (const envName of Object.keys(record.values ?? {})) {
    if (!envSet.has(envName)) {
      errors.push(`${record.path}: values contains undeclared env "${envName}"`);
    }
  }
}
function validateSecretValue(record, errors) {
  if (record.kind !== "secret") return;
  const hasValues = record.values !== void 0 && Object.keys(record.values).length > 0;
  if (record.value === void 0 && !hasValues) {
    errors.push(`${record.path}: secret requires value, default, or at least one values entry`);
  }
}
function flattenKeyTree(tree, errors, prefix = []) {
  const records = [];
  for (const [rawKey, value] of Object.entries(tree)) {
    const fullParts = [...prefix, ...rawKey.split("/")];
    const path = fullParts.join("/");
    validatePathParts(fullParts, errors);
    records.push(...flattenKeyNode(value, path, fullParts, errors));
  }
  return records;
}
function flattenKeyNode(value, path, fullParts, errors) {
  if (isConfigRecord(value)) return [normalizeConfigRecord(path, value, errors)];
  if (isSecretRecord(value)) return [normalizeSecretRecord(path, value, errors)];
  const scalar = configScalarSchema.safeParse(value);
  if (scalar.success) return [normalizeScalarRecord(path, scalar.data)];
  return flattenKeyTree(value, errors, fullParts);
}
function normalizeConfigRecord(path, input, errors) {
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
function normalizeSecretRecord(path, input, errors) {
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
function normalizeMovedFrom(value) {
  if (value === void 0) return void 0;
  return Array.isArray(value) ? [...value] : [value];
}
function resolveBinding(path, value, fallback, errors) {
  if (value !== void 0 && fallback !== void 0) {
    errors.push(`${path}: value and default are mutually exclusive`);
  }
  return value ?? fallback;
}
function normalizeScalarRecord(path, value) {
  return {
    path,
    kind: "config",
    optional: false,
    value
  };
}
function validatePathParts(parts, errors) {
  for (const part of parts) {
    if (!PATH_SEGMENT_RE.test(part)) {
      errors.push(`${parts.join("/")}: invalid path segment "${part}"`);
    }
  }
}
function validatePathConflicts(records, errors) {
  const sorted = [...records].sort((a, b) => a.path.localeCompare(b.path));
  const seen = /* @__PURE__ */ new Set();
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
function validateMovedFrom(records, paths, errors) {
  for (const record of records) {
    if (record.movedFrom === void 0) continue;
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
function validateTemplateReferences(records, paths, errors) {
  const graph = buildTemplateGraph(records, paths, errors);
  validateTemplateGraph(graph, errors);
}
function buildTemplateGraph(records, paths, errors) {
  const graph = /* @__PURE__ */ new Map();
  for (const record of records) {
    if (record.kind !== "config") continue;
    graph.set(record.path, validateTemplateRecord(record, paths, errors));
  }
  return graph;
}
function validateTemplateRecord(record, paths, errors) {
  const references = getTemplateReferences(record);
  for (const reference of references) {
    if (!paths.has(reference)) {
      errors.push(`${record.path}: template references unknown key "${reference}"`);
    }
  }
  return references.filter((reference) => paths.has(reference));
}
function getTemplateReferences(record) {
  return [
    ...extractTemplateReferences(record.value),
    ...Object.values(record.values ?? {}).flatMap((value) => extractTemplateReferences(value))
  ];
}
function validateTemplateGraph(graph, errors) {
  const state = {
    visiting: /* @__PURE__ */ new Set(),
    visited: /* @__PURE__ */ new Set(),
    stack: []
  };
  for (const path of graph.keys()) {
    visitTemplatePath(path, graph, state, errors);
  }
}
function visitTemplatePath(path, graph, state, errors) {
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
function reportTemplateCycle(path, stack, errors) {
  const cycleStart = stack.indexOf(path);
  const cycle = [...stack.slice(cycleStart), path].join(" -> ");
  errors.push(`template cycle detected: ${cycle}`);
}
function extractTemplateReferences(value) {
  if (typeof value !== "string") return [];
  const references = [];
  TEMPLATE_RE2.lastIndex = 0;
  for (const match of value.matchAll(TEMPLATE_RE2)) {
    references.push(match[1].trim());
  }
  return references;
}
function checkUnique(label, values, errors) {
  const seen = /* @__PURE__ */ new Set();
  for (const value of values) {
    if (seen.has(value)) {
      errors.push(`${label}: duplicate "${value}"`);
    }
    seen.add(value);
  }
}
function copyDefinedRecord(values) {
  if (values === void 0) return void 0;
  const copy = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== void 0) {
      copy[key] = value;
    }
  }
  return copy;
}
function isConfigRecord(value) {
  return getKind(value) === "config";
}
function isSecretRecord(value) {
  return getKind(value) === "secret";
}
function getKind(value) {
  if (value == null) return void 0;
  if (typeof value !== "object") return void 0;
  if (Array.isArray(value)) return void 0;
  return value.__kind;
}

// ../cli/dist/src/config/loader.js
var CONFIG_FILE = "keyshelf.config.ts";
var V4_SCHEMA_FILE = "keyshelf.yaml";
var APP_MAPPING_FILE = ".env.keyshelf";
var V4ConfigDetectedError = class extends Error {
  v4SchemaPath;
  v4RootDir;
  constructor(v4RootDir) {
    const v4SchemaPath = join(v4RootDir, V4_SCHEMA_FILE);
    super(
      `Detected v4 keyshelf.yaml at ${v4SchemaPath} but no ${CONFIG_FILE} in any parent directory. Run \`npx @keyshelf/migrate\` from ${v4RootDir} to migrate to v5.`
    );
    this.name = "V4ConfigDetectedError";
    this.v4SchemaPath = v4SchemaPath;
    this.v4RootDir = v4RootDir;
  }
};
var cachedJiti;
function getJiti() {
  if (cachedJiti === void 0) {
    const override = process.env.KEYSHELF_CONFIG_MODULE_PATH;
    const configModulePath = override !== void 0 ? resolve(override) : fileURLToPath(new URL("./factories.js", import.meta.url));
    cachedJiti = createJiti(import.meta.url, {
      alias: {
        "keyshelf/config": configModulePath
      }
    });
  }
  return cachedJiti;
}
function findRootDir(from) {
  let dir = resolve(from);
  let v4RootDir;
  while (true) {
    if (existsSync(join(dir, CONFIG_FILE))) {
      return dir;
    }
    if (v4RootDir === void 0 && existsSync(join(dir, V4_SCHEMA_FILE))) {
      v4RootDir = dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      if (v4RootDir !== void 0) {
        throw new V4ConfigDetectedError(v4RootDir);
      }
      throw new Error(`Could not find ${CONFIG_FILE} in ${from} or any parent directory`);
    }
    dir = parent;
  }
}
async function loadConfig(appDir, options = {}) {
  const explicitConfigPath = options.configPath === void 0 ? void 0 : resolve(options.configPath);
  const rootDir = explicitConfigPath === void 0 ? findRootDir(appDir) : dirname(explicitConfigPath);
  const configPath = explicitConfigPath ?? join(rootDir, CONFIG_FILE);
  const started = performance.now();
  const rawConfig = await importConfig(configPath);
  const config = normalizeConfig(rawConfig);
  const loadTimeMs = performance.now() - started;
  const mappingPath = options.mappingFile ? resolve(options.mappingFile) : join(resolve(appDir), APP_MAPPING_FILE);
  const appMapping = await loadAppMapping(mappingPath, options.mappingFile !== void 0);
  validateAppMappingReferences(appMapping, config.keys);
  return {
    rootDir,
    configPath,
    config,
    appMapping,
    loadTimeMs
  };
}
async function importConfig(configPath) {
  return await getJiti().import(configPath, { default: true });
}
async function loadAppMapping(mappingPath, required) {
  try {
    return parseAppMapping(await readFile(mappingPath, "utf-8"));
  } catch (err) {
    if (err.code === "ENOENT") {
      if (required) {
        throw new Error(`App mapping file not found: ${mappingPath}`, {
          cause: err
        });
      }
      return [];
    }
    throw err;
  }
}
function ageIdentityFile(binding) {
  if (binding?.__kind !== "provider:age") return void 0;
  const file = binding.options?.identityFile;
  return typeof file === "string" && file.length > 0 ? file : void 0;
}
function collectAgeIdentityFiles(config) {
  const seen = /* @__PURE__ */ new Set();
  for (const record of config.keys) {
    if (record.kind !== "secret") continue;
    addIfAge(seen, record.value);
    for (const v of Object.values(record.values ?? {})) addIfAge(seen, v);
  }
  return [...seen];
}
function addIfAge(seen, binding) {
  const file = ageIdentityFile(binding);
  if (file !== void 0) seen.add(file);
}
function resolveIdentityPath(filePath, rootDir) {
  if (filePath === "~" || filePath.startsWith("~/")) {
    return join(homedir(), filePath.slice(1));
  }
  if (isAbsolute(filePath)) return filePath;
  return resolve(rootDir, filePath);
}
function ensureTrailingNewline(content) {
  return content.endsWith("\n") ? content : content + "\n";
}

// scripts/write-identity.mjs
var identity = process.env.KEYSHELF_IDENTITY;
var cwd = process.env.KEYSHELF_CWD || process.cwd();
if (!identity) {
  process.stdout.write("No identity provided; skipping identity write.\n");
  process.exit(0);
}
var loaded = await loadConfig(cwd);
var identityFiles = collectAgeIdentityFiles(loaded.config);
if (identityFiles.length === 0) {
  process.stdout.write(
    `::warning::'identity' input was provided but config "${loaded.config.name}" declares no age providers. Ignoring.
`
  );
  process.exit(0);
}
for (const filePath of identityFiles) {
  const target = resolveIdentityPath(filePath, loaded.rootDir);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, ensureTrailingNewline(identity), { mode: 384 });
  await chmod(target, 384);
  process.stdout.write(`Wrote identity to ${target} (mode 0600)
`);
}
