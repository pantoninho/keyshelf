import type { Adapter } from "./adapters/adapter.js";
import { KeyshelfError } from "./errors.js";
import type { EnvironmentValue, KeyReference, LoadedEnvironment } from "./model.js";

/** The canonical env-var identifier rule (docs/reference.md). */
const KEY_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

/**
 * The dependencies resolution needs to reach beyond the environment being run.
 * Both stay **above the adapter seam** (ADR-0002): `loadEnvironment` wraps the
 * pure loader and `adapterFor` builds the provider's adapter for any
 * environment — never an adapter itself. A `!ref` uses them to load the target
 * shelf's environment and resolve the referenced key through the *target's* own
 * provider, which is what makes a value shared across different backends.
 */
export interface ResolveDeps {
  /** Build the adapter for the given (consuming or referenced) environment. */
  adapterFor(loaded: LoadedEnvironment): Adapter;
  /** Load a referenced `{shelf}/{stage}` environment, mapping the same load errors. */
  loadEnvironment(shelf: string, stage: string): Promise<LoadedEnvironment>;
}

/**
 * Resolve a structurally-valid environment into the flat `string→string` map of
 * env-var names → values that Keyshelf manages.
 *
 * Merge order (docs/reference.md "run resolution & precedence", steps 1–2):
 * 1. A schema `config` key contributes its default unless the environment
 *    overrides it; an environment plaintext value wins. `!required`/`!optional`
 *    keys with no default and no environment value contribute nothing.
 * 2. Every `!secret` resolves through the environment's provider's `adapter` —
 *    by convention on the key name, or via the explicit `{ ref: ... }` override.
 *
 * The consuming environment's adapter is built **lazily**, only when it
 * actually declares a local `!secret`. This keeps a config-only (or all-`!ref`)
 * environment resolvable without constructing its provider's adapter.
 *
 * A `!ref` key reference resolves **one hop** through the *target* environment
 * (ADR-0007): `deps.loadEnvironment` loads the target shelf's schema and
 * `{shelf}/{stage}.yaml`, only the referenced key is resolved, and a `!secret`
 * target resolves through the **target's** own provider (`deps.adapterFor`).
 * Landing on another `!ref` is `INVALID_REFERENCE`; a missing target shelf,
 * stage, or key is `REFERENCE_NOT_FOUND`.
 *
 * Resolution is fail-fast: if anything is unresolvable a {@link KeyshelfError}
 * is thrown and no map is returned, so a caller never launches a half-populated
 * environment. The config-merge step is pure; only secret resolution touches the
 * backend (through the adapter seam).
 */
export async function resolveEnvironment(
  loaded: LoadedEnvironment,
  deps: ResolveDeps
): Promise<Record<string, string>> {
  const { schema, environment } = loaded;
  const map: Record<string, string> = {};

  // Schema config defaults form the base layer.
  for (const [key, declared] of Object.entries(schema.keys)) {
    if (declared.kind === "config" && declared.default !== undefined) {
      map[key] = declared.default;
    }
  }

  // Build the consuming environment's adapter once, on first local secret only.
  let adapter: Adapter | undefined;

  // Environment values overlay the defaults: plaintext wins directly; a !secret
  // resolves through this environment's provider; a !ref resolves through the
  // target environment's provider.
  for (const [key, value] of Object.entries(environment.keys)) {
    if (value.kind === "secret") {
      adapter ??= deps.adapterFor(loaded);
      map[key] = await resolveSecret(adapter, key, value.ref);
    } else if (value.kind === "ref") {
      map[key] = await resolveReference(key, value.reference, environment.name, deps);
    } else {
      map[key] = value.value ?? "";
    }
  }

  return map;
}

/**
 * Resolve a `!ref` one hop: load the target `{shelf}/{stage}`, locate the
 * referenced key, and yield its value — config directly, secret through the
 * target's own provider. The defaults are applied here: `key` falls back to the
 * consuming key's name, `stage` to the current stage.
 */
async function resolveReference(
  consumingKey: string,
  reference: KeyReference | undefined,
  currentStage: string,
  deps: ResolveDeps
): Promise<string> {
  if (reference === undefined) {
    // The loader never produces a ref-kind value without a reference; guard anyway.
    throw new KeyshelfError("INVALID_REFERENCE", `Key '${consumingKey}' has a malformed !ref.`, {
      key: consumingKey
    });
  }

  const targetKey = reference.key ?? consumingKey;
  const targetStage = reference.stage ?? currentStage;
  const { target, value } = await loadReferenceTarget(
    consumingKey,
    reference.shelf,
    targetKey,
    targetStage,
    deps
  );

  // A secret target resolves through the TARGET's own provider; config is direct.
  if (value.kind === "secret") {
    return resolveSecret(deps.adapterFor(target), targetKey, value.ref);
  }
  return value.value ?? "";
}

/**
 * Load the target `{shelf}/{stage}` and return the non-`!ref` {@link
 * EnvironmentValue} the referenced key supplies. A missing target shelf/stage/key
 * is `REFERENCE_NOT_FOUND`; landing on another `!ref` is `INVALID_REFERENCE` (one
 * hop only — resolution never recurses).
 */
async function loadReferenceTarget(
  consumingKey: string,
  targetShelf: string,
  targetKey: string,
  targetStage: string,
  deps: ResolveDeps
): Promise<{ target: LoadedEnvironment; value: EnvironmentValue }> {
  const targetId = `${targetShelf}/${targetStage}`;
  const where = { key: consumingKey, target: `${targetId}#${targetKey}` };

  let target: LoadedEnvironment;
  try {
    target = await deps.loadEnvironment(targetShelf, targetStage);
  } catch (error) {
    // A missing target shelf/stage (or its schema/env file) is a dangling
    // reference, surfaced uniformly as REFERENCE_NOT_FOUND.
    if (error instanceof KeyshelfError) {
      throw new KeyshelfError(
        "REFERENCE_NOT_FOUND",
        `Key '${consumingKey}' references '${where.target}', but ${targetId} could not be loaded: ${error.message}`,
        { ...where, cause: error.code }
      );
    }
    throw error;
  }

  const value = targetEnvironmentValue(target, targetKey);
  if (value === undefined) {
    throw new KeyshelfError(
      "REFERENCE_NOT_FOUND",
      `Key '${consumingKey}' references '${where.target}', but that key supplies no value.`,
      where
    );
  }

  if (value.kind === "ref") {
    throw new KeyshelfError(
      "INVALID_REFERENCE",
      `Key '${consumingKey}' references '${where.target}', which is itself a !ref (one hop only).`,
      where
    );
  }

  return { target, value };
}

/**
 * The effective value a target environment supplies for a key: its environment
 * entry if present, otherwise the shelf schema's config default for that key.
 * `undefined` when the key is neither — a dangling reference.
 */
function targetEnvironmentValue(
  target: LoadedEnvironment,
  key: string
): EnvironmentValue | undefined {
  const declared = target.environment.keys[key];
  if (declared !== undefined) return declared;

  const schemaKey = target.schema.keys[key];
  if (schemaKey?.kind === "config" && schemaKey.default !== undefined) {
    return { kind: "config", value: schemaKey.default };
  }

  return undefined;
}

/** Resolve one secret through the adapter, normalising non-Keyshelf throws. */
async function resolveSecret(adapter: Adapter, key: string, ref: unknown): Promise<string> {
  try {
    return await adapter.resolve(key, ref);
  } catch (error) {
    if (error instanceof KeyshelfError) throw error;
    throw new KeyshelfError(
      "ADAPTER_ERROR",
      `Failed to resolve secret '${key}': ${String(error)}`,
      { key }
    );
  }
}

/** A parsed `--set KEY=VALUE` flag. */
export interface SetAssignment {
  key: string;
  value: string;
}

/** Parse a single `--set KEY=VALUE` token, splitting on the first `=` only. */
export function parseSet(assignment: string): SetAssignment {
  const eq = assignment.indexOf("=");
  if (eq === -1) {
    throw new KeyshelfError("MALFORMED_FILE", `--set expects KEY=VALUE; got '${assignment}'.`, {
      reason: "expected KEY=VALUE",
      value: assignment
    });
  }

  const key = assignment.slice(0, eq);
  if (!KEY_NAME_PATTERN.test(key)) {
    throw new KeyshelfError(
      "INVALID_KEY_NAME",
      `--set key '${key}' is not a valid env-var identifier (expected ${KEY_NAME_PATTERN}).`,
      { key }
    );
  }

  return { key, value: assignment.slice(eq + 1) };
}

/**
 * Build the child process environment by applying precedence (lowest → highest):
 * inherited ambient env → Keyshelf's resolved managed values → explicit `--set`.
 *
 * The inherited ambient value survives only for keys Keyshelf does not manage; a
 * stale ambient var of a managed key is overridden by the resolved value.
 */
export function buildChildEnv(input: {
  ambient: Record<string, string | undefined>;
  managed: Record<string, string>;
  sets: Record<string, string>;
}): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(input.ambient)) {
    if (value !== undefined) out[key] = value;
  }

  Object.assign(out, input.managed, input.sets);
  return out;
}
