import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isMap, isScalar, parseDocument, type YAMLMap } from "yaml";
import { KeyshelfError } from "./errors.js";
import type {
  Config,
  Environment,
  EnvironmentValue,
  LoadedEnvironment,
  Provider,
  Schema,
  SchemaKey
} from "./model.js";

const ROOT_DIR = ".keyshelf";
const CONFIG_FILE = "config.yaml";
const SCHEMA_FILE = "schema.yaml";

/** Resolve the `.keyshelf` root for a project, asserting it is initialized. */
function keyshelfRoot(projectDir: string): string {
  const root = path.join(projectDir, ROOT_DIR);
  if (!existsSync(path.join(root, CONFIG_FILE))) {
    throw new KeyshelfError(
      "NOT_INITIALIZED",
      `No Keyshelf project found in '${projectDir}'. Run 'keyshelf init' first.`,
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
  const file = path.join(root, shelf, SCHEMA_FILE);
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

async function loadEnvironmentFile(
  root: string,
  shelf: string,
  name: string
): Promise<Environment> {
  const file = path.join(root, shelf, `${name}.yaml`);
  const doc = parse(await readFile(file, "utf8"), file);

  const top = doc.contents;
  if (!isMap(top)) {
    throw malformed(file, "expected a mapping at the top level");
  }

  const providerNode = (top as YAMLMap).get("provider");
  if (typeof providerNode !== "string" || providerNode.length === 0) {
    throw malformed(file, "missing required 'provider' string");
  }

  const keys = readKeysMap<EnvironmentValue>(doc, file, (node, key) => {
    if (isScalar(node)) {
      if (node.tag === "!secret") {
        return { kind: "secret" };
      }

      return { kind: "config", value: node.value === null ? "" : String(node.value) };
    }

    if (isMap(node) && (node as YAMLMap).tag === "!secret") {
      return { kind: "secret", ref: (node as YAMLMap).toJSON() };
    }

    if (node === null || node === undefined) {
      return { kind: "config", value: "" };
    }

    throw malformed(file, `key '${key}' has an unsupported value (expected a string or !secret)`);
  });

  return { shelf, name, provider: providerNode, keys };
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

  const shelfDir = path.join(root, shelf);
  if (!existsSync(shelfDir)) {
    throw new KeyshelfError("SHELF_NOT_FOUND", `Shelf '${shelf}' does not exist.`, { shelf });
  }

  if (!existsSync(path.join(shelfDir, SCHEMA_FILE))) {
    throw new KeyshelfError("SCHEMA_NOT_FOUND", `Shelf '${shelf}' has no ${SCHEMA_FILE}.`, {
      shelf
    });
  }

  if (!existsSync(path.join(shelfDir, `${stage}.yaml`))) {
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
 * Discover every `{shelf}/{stage}` in a project by walking `.keyshelf/`. A shelf is
 * a directory; an environment is a `*.yaml` file in it that is neither
 * `schema.yaml` nor a `*.secrets.yaml` store. Throws `NOT_INITIALIZED` when the
 * project is not initialized.
 */
/** Whether a directory entry is an environment file (a `*.yaml` that is neither schema nor a secrets store). */
function isEnvironmentFile(name: string): boolean {
  if (name === SCHEMA_FILE) return false;
  if (name.endsWith(".secrets.yaml")) return false;
  return name.endsWith(".yaml");
}

/** The environments declared in a single shelf directory. */
async function listShelfEnvironments(root: string, shelf: string): Promise<EnvironmentRef[]> {
  const files = await readdir(path.join(root, shelf), { withFileTypes: true });
  return files
    .filter((file) => file.isFile() && isEnvironmentFile(file.name))
    .map((file) => ({ shelf, stage: file.name.slice(0, -".yaml".length) }));
}

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
