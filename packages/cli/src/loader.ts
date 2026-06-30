import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isMap, isScalar, parseDocument, type YAMLMap } from "yaml";
import { KeyshelfError } from "./errors.js";
import type {
  Config,
  Environment,
  EnvironmentValue,
  KeyReference,
  LoadedEnvironment,
  Provider,
  Schema,
  SchemaKey
} from "./model.js";
import {
  CONFIG_FILE,
  envFilePath,
  ROOT_DIR,
  SCHEMA_FILE,
  schemaFilePath,
  shelfDir,
  shelfEnvDir
} from "./paths.js";

/** Whether `dir` directly holds a `.keyshelf/config.yaml` (an initialized project root). */
function hasProject(dir: string): boolean {
  return existsSync(path.join(dir, ROOT_DIR, CONFIG_FILE));
}

/**
 * Discover the project root by walking up from `startDir` toward the filesystem
 * root, returning the nearest ancestor directory that holds
 * `.keyshelf/config.yaml` — the way git/npm find their marker. This lets every
 * read/write command run from any subfolder of a project. The traversal stops at
 * the filesystem root; if no ancestor is initialized it throws `NOT_INITIALIZED`,
 * stating that the working directory and its parents were searched.
 *
 * The discovered root replaces `process.cwd()` as the `projectDir` everywhere it
 * flows (reads, `set` writes, adapter relative paths, dependency resolution), so
 * everything anchors to the real project root rather than the raw cwd.
 */
export async function findProjectDir(startDir: string): Promise<string> {
  let dir = path.resolve(startDir);
  for (;;) {
    if (hasProject(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached the filesystem root
    dir = parent;
  }

  throw new KeyshelfError(
    "NOT_INITIALIZED",
    `No Keyshelf project found in '${startDir}' or any parent directory. Run 'keyshelf init' first.`,
    { path: path.join(startDir, ROOT_DIR) }
  );
}

/** Resolve the `.keyshelf` root for a project, asserting it is initialized. */
function keyshelfRoot(projectDir: string): string {
  const root = path.join(projectDir, ROOT_DIR);
  if (!existsSync(path.join(root, CONFIG_FILE))) {
    throw new KeyshelfError(
      "NOT_INITIALIZED",
      `No Keyshelf project found in '${projectDir}' or any parent directory. Run 'keyshelf init' first.`,
      {
        path: root
      }
    );
  }

  return root;
}

/** Parse YAML text into a document, mapping syntax errors to MALFORMED_FILE. */
function parse(text: string, file: string) {
  let doc;
  try {
    doc = parseDocument(text);
  } catch (error) {
    throw malformed(file, error instanceof Error ? error.message : String(error));
  }

  if (doc.errors.length > 0) {
    throw malformed(file, doc.errors[0].message);
  }

  return doc;
}

function malformed(file: string, reason: string): KeyshelfError {
  return new KeyshelfError("MALFORMED_FILE", `Could not parse '${file}': ${reason}`, {
    file,
    reason
  });
}

/** A non-null, non-array object — i.e. a YAML mapping once parsed to JS. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validate and normalize one provider entry into a {@link Provider}. */
function parseProvider(file: string, name: string, raw: unknown): Provider {
  if (!isPlainObject(raw)) {
    throw malformed(file, `provider '${name}' must be a mapping`);
  }

  if (typeof raw.adapter !== "string") {
    throw malformed(file, `provider '${name}' is missing an 'adapter' string`);
  }

  return { ...raw, adapter: raw.adapter };
}

/** Parse the optional `providers:` mapping, validating each entry has an `adapter` string. */
function parseProviders(file: string, rawProviders: unknown): Record<string, Provider> {
  if (rawProviders === undefined) return {};

  if (!isPlainObject(rawProviders)) {
    throw malformed(file, "'providers' must be a mapping");
  }

  const providers: Record<string, Provider> = {};
  for (const [name, raw] of Object.entries(rawProviders)) {
    providers[name] = parseProvider(file, name, raw);
  }

  return providers;
}

async function loadConfig(root: string): Promise<Config> {
  const file = path.join(root, CONFIG_FILE);
  const doc = parse(await readFile(file, "utf8"), file);
  const obj = doc.toJS() as unknown;

  if (!isPlainObject(obj)) {
    throw malformed(file, "expected a mapping at the top level");
  }

  if (typeof obj.project !== "string" || obj.project.length === 0) {
    throw malformed(file, "missing required 'project' string");
  }

  return { project: obj.project, providers: parseProviders(file, obj.providers) };
}

/** Read a `keys:` mapping node, applying `parseValue` to each entry's value node. */
function readKeysMap<T>(
  doc: ReturnType<typeof parseDocument>,
  file: string,
  parseValue: (node: unknown, key: string) => T
): Record<string, T> {
  const top = doc.contents;
  if (!isMap(top)) {
    throw malformed(file, "expected a mapping at the top level");
  }

  const keysNode = (top as YAMLMap).get("keys", true);
  if (keysNode === undefined || keysNode === null) {
    return {};
  }

  if (!isMap(keysNode)) {
    throw malformed(file, "'keys' must be a mapping");
  }

  const out: Record<string, T> = {};
  for (const item of (keysNode as YAMLMap).items) {
    const key = isScalar(item.key)
      ? String(item.key.value)
      : String((item.key as { value?: unknown })?.value ?? item.key);
    out[key] = parseValue(item.value, key);
  }

  return out;
}

async function loadSchema(root: string, shelf: string): Promise<Schema> {
  const file = schemaFilePath(root, shelf);
  const doc = parse(await readFile(file, "utf8"), file);

  const keys = readKeysMap<SchemaKey>(doc, file, (node) => {
    if (isScalar(node)) {
      const { tag } = node;
      if (tag === "!required") return { kind: "required" };
      if (tag === "!optional") return { kind: "optional" };
      // A bare scalar with no presence tag is a config default.
      return { kind: "config", default: node.value === null ? "" : String(node.value) };
    }

    if (node === null || node === undefined) {
      // `KEY:` with no value — treat as an empty config default.
      return { kind: "config", default: "" };
    }

    throw malformed(
      file,
      `key has an unsupported declaration (expected a default value, !required, or !optional)`
    );
  });

  return { keys };
}

/**
 * Read a non-empty string `field` from a `!ref` mapping. A required field that is
 * absent, or any field that is present but not a non-empty string, is a
 * `MALFORMED_FILE`; an absent optional field yields `undefined`.
 */
function refField(
  file: string,
  key: string,
  raw: Record<string, unknown>,
  field: string,
  required: boolean
): string | undefined {
  const value = raw[field];
  if (value === undefined) {
    if (required) {
      throw malformed(file, `key '${key}' has a !ref missing the required '${field}' field`);
    }
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw malformed(file, `key '${key}' has a !ref with a non-string '${field}'`);
  }
  return value;
}

/**
 * Validate a `!ref` mapping payload into a {@link KeyReference}. `shelf` is
 * required; `key` and `stage` are optional (their defaults are applied at
 * resolution, not here). A scalar `!ref` or a missing/empty `shelf` is a
 * `MALFORMED_FILE`.
 */
function parseKeyReference(file: string, key: string, raw: unknown): KeyReference {
  if (!isPlainObject(raw)) {
    throw malformed(file, `key '${key}' has an invalid !ref (expected a mapping with a 'shelf')`);
  }

  const reference: KeyReference = { shelf: refField(file, key, raw, "shelf", true) as string };
  const targetKey = refField(file, key, raw, "key", false);
  if (targetKey !== undefined) reference.key = targetKey;
  const stage = refField(file, key, raw, "stage", false);
  if (stage !== undefined) reference.stage = stage;

  return reference;
}

/**
 * Validate an optional `version:` on a `!secret` payload into a pinned version
 * (ADR-0009). Absent ⇒ `undefined` (the reference floats / resolves `latest`).
 * Present-but-not-a-positive-integer is a `MALFORMED_FILE`. The version is
 * interpreted by the adapter; core only proves it is a sane positive integer
 * here and surfaces it for offline visibility.
 */
function parseSecretVersion(file: string, key: string, payload: unknown): number | undefined {
  if (!isPlainObject(payload)) return undefined;
  const raw = payload.version;
  if (raw === undefined) return undefined;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
    throw malformed(
      file,
      `key '${key}' has a !secret with an invalid 'version' (expected a positive integer)`
    );
  }
  return raw;
}

async function loadEnvironmentFile(
  root: string,
  shelf: string,
  name: string
): Promise<Environment> {
  const file = envFilePath(root, shelf, name);
  const doc = parse(await readFile(file, "utf8"), file);

  const top = doc.contents;
  if (!isMap(top)) {
    throw malformed(file, "expected a mapping at the top level");
  }

  // `provider:` is optional (ADR-0007): a config-only or `!ref`-only mapping
  // environment may omit it. When present it must be a non-empty string; when
  // absent it stays undefined and the conditional rule is enforced in validate.
  const map = top as YAMLMap;
  const hasProvider = map.has("provider");
  const providerNode = map.get("provider");
  let provider: string | undefined;
  if (hasProvider) {
    if (typeof providerNode !== "string" || providerNode.length === 0) {
      throw malformed(file, "'provider' must be a non-empty string when present");
    }
    provider = providerNode;
  }

  const keys = readKeysMap<EnvironmentValue>(doc, file, (node, key) => {
    if (isScalar(node)) {
      if (node.tag === "!secret") {
        return { kind: "secret" };
      }

      // A scalar `!ref` is malformed: a key reference is always a mapping.
      if (node.tag === "!ref") {
        throw malformed(file, `key '${key}' has a scalar !ref (expected a mapping with a 'shelf')`);
      }

      return { kind: "config", value: node.value === null ? "" : String(node.value) };
    }

    if (isMap(node) && (node as YAMLMap).tag === "!secret") {
      const payload = (node as YAMLMap).toJSON() as Record<string, unknown>;
      const version = parseSecretVersion(file, key, payload);
      return version === undefined
        ? { kind: "secret", ref: payload }
        : { kind: "secret", ref: payload, version };
    }

    if (isMap(node) && (node as YAMLMap).tag === "!ref") {
      return { kind: "ref", reference: parseKeyReference(file, key, (node as YAMLMap).toJSON()) };
    }

    if (node === null || node === undefined) {
      return { kind: "config", value: "" };
    }

    throw malformed(
      file,
      `key '${key}' has an unsupported value (expected a string, !secret, or !ref)`
    );
  });

  return { shelf, name, provider, keys };
}

/**
 * Load a single environment (`{shelf}/{stage}`) into the model: the project
 * `config.yaml`, the shelf's `schema.yaml`, and the environment file. Maps
 * structural failures to the closed error codes — `NOT_INITIALIZED`,
 * `SHELF_NOT_FOUND`, `SCHEMA_NOT_FOUND`, `ENVIRONMENT_NOT_FOUND`,
 * `MALFORMED_FILE`. Does not resolve any `!secret` values.
 */
export async function loadEnvironment(
  projectDir: string,
  shelf: string,
  stage: string
): Promise<LoadedEnvironment> {
  const root = keyshelfRoot(projectDir);
  const config = await loadConfig(root);

  if (!existsSync(shelfDir(root, shelf))) {
    throw new KeyshelfError("SHELF_NOT_FOUND", `Shelf '${shelf}' does not exist.`, { shelf });
  }

  if (!existsSync(schemaFilePath(root, shelf))) {
    throw new KeyshelfError("SCHEMA_NOT_FOUND", `Shelf '${shelf}' has no ${SCHEMA_FILE}.`, {
      shelf
    });
  }

  if (!existsSync(envFilePath(root, shelf, stage))) {
    throw new KeyshelfError(
      "ENVIRONMENT_NOT_FOUND",
      `Environment '${shelf}/${stage}' does not exist.`,
      {
        shelf,
        environment: `${shelf}/${stage}`
      }
    );
  }

  const schema = await loadSchema(root, shelf);
  const environment = await loadEnvironmentFile(root, shelf, stage);

  return { config, schema, environment };
}

/** An environment's filesystem-derived identity, discovered by {@link listEnvironments}. */
export interface EnvironmentRef {
  shelf: string;
  stage: string;
}

/**
 * The environments declared in a single shelf directory: every `*.yaml` in the
 * shelf's `environments/` folder, its stage being the file's basename. There is
 * no exclusion rule — the schema lives outside that folder (ADR-0011). A missing
 * or empty `environments/` folder means zero environments, not an error.
 */
async function listShelfEnvironments(root: string, shelf: string): Promise<EnvironmentRef[]> {
  let files;
  try {
    files = await readdir(shelfEnvDir(root, shelf), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return files
    .filter((file) => file.isFile() && file.name.endsWith(".yaml"))
    .map((file) => ({ shelf, stage: file.name.slice(0, -".yaml".length) }));
}

/**
 * Discover every `{shelf}/{stage}` in a project by walking `.keyshelf/`. A shelf is
 * a directory; its environments are every `*.yaml` file in its reserved
 * `environments/` folder (ADR-0011). Throws `NOT_INITIALIZED` when the project is
 * not initialized.
 */
export async function listEnvironments(projectDir: string): Promise<EnvironmentRef[]> {
  const root = keyshelfRoot(projectDir);
  const shelves = await readdir(root, { withFileTypes: true });

  const refs: EnvironmentRef[] = [];
  for (const shelfEntry of shelves) {
    if (!shelfEntry.isDirectory()) continue;
    refs.push(...(await listShelfEnvironments(root, shelfEntry.name)));
  }

  return refs;
}

/** One shelf's offline shape: its schema contract size and its environments. */
export interface ShelfMap {
  shelf: string;
  /** The shelf's schema contract size (count of keys declared in `schema.yaml`). */
  keys: number;
  /** The shelf's environment stages, sorted alphabetically. */
  stages: string[];
}

/** An offline map of the whole project: every shelf with its shape. */
export interface ProjectMap {
  /** Every shelf, sorted alphabetically by name. */
  shelves: ShelfMap[];
}

/**
 * Build an offline map of the project (ADR-0008): every shelf, its schema's key
 * count, and the environments under it. A pure file read — it builds no provider,
 * touches no backend, and reads no key values. Shelves and their environment
 * stages are each sorted alphabetically.
 *
 * Throws `NOT_INITIALIZED` when the project is not initialized. A broken shelf
 * (missing or malformed `schema.yaml`) fails fast with that shelf's
 * `KeyshelfError` — the whole map aborts rather than render partially.
 */
export async function loadProjectMap(projectDir: string): Promise<ProjectMap> {
  const root = keyshelfRoot(projectDir);
  const entries = await readdir(root, { withFileTypes: true });

  const shelfNames = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const shelves: ShelfMap[] = [];
  for (const shelf of shelfNames) {
    if (!existsSync(schemaFilePath(root, shelf))) {
      throw new KeyshelfError("SCHEMA_NOT_FOUND", `Shelf '${shelf}' has no ${SCHEMA_FILE}.`, {
        shelf
      });
    }

    const schema = await loadSchema(root, shelf);
    const environments = await listShelfEnvironments(root, shelf);
    const stages = environments.map((env) => env.stage).sort((a, b) => a.localeCompare(b));

    shelves.push({ shelf, keys: Object.keys(schema.keys).length, stages });
  }

  return { shelves };
}
