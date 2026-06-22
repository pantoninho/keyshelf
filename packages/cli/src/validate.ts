import { KeyshelfError } from "./errors.js";
import type { EnvironmentValue, KeyReference, LoadedEnvironment } from "./model.js";

/** The canonical env-var identifier rule (docs/reference.md). */
const KEY_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

/**
 * Validate a single loaded environment against the closed-contract and presence
 * rules. Pure logic, no I/O — the loader has already turned files into the model.
 *
 * Checks, in order:
 * 1. If a local `!secret` is declared, the referenced provider is present and
 *    exists in `config.providers`                           → `PROVIDER_NOT_FOUND`
 * 2. Every key name is a valid env-var identifier          → `INVALID_KEY_NAME`
 * 3. Every environment key is declared in the schema        → `UNKNOWN_KEY`
 * 4. Every `!required` schema key is supplied               → `MISSING_REQUIRED`
 *
 * `provider:` is required **iff** the environment declares at least one local
 * `!secret` (ADR-0007). A config-only or `!ref`-only mapping environment holds no
 * local secret, so an absent provider is fine — each `!ref` resolves through its
 * target's provider, never a local one.
 *
 * Does **not** resolve `!secret` values — a `!secret` entry is structurally fine
 * here. A `!ref` value is likewise structurally fine: it sits in
 * `environment.keys`, so it **discharges** a `!required` key (check 4), exactly as
 * a config or secret value would. The cross-shelf checks a `!ref` needs (target
 * shelf/stage/key present, one hop) live in {@link validateReferences}, which
 * reaches the filesystem and so is kept separate from this pure check.
 *
 * Throws the first {@link KeyshelfError} it finds, carrying the relevant
 * structured fields (`shelf`, `environment`, `key`, `provider`).
 */
export function validateEnvironment(loaded: LoadedEnvironment): void {
  const { config, schema, environment } = loaded;
  const { shelf, name } = environment;
  const where = { shelf, environment: `${shelf}/${name}` };

  const hasLocalSecret = Object.values(environment.keys).some((value) => value.kind === "secret");
  if (hasLocalSecret) {
    if (
      environment.provider === undefined ||
      !Object.prototype.hasOwnProperty.call(config.providers, environment.provider)
    ) {
      throw new KeyshelfError(
        "PROVIDER_NOT_FOUND",
        `Environment '${shelf}/${name}' declares a local !secret but references ` +
          `${environment.provider === undefined ? "no provider" : `undefined provider '${environment.provider}'`}.`,
        { ...where, provider: environment.provider }
      );
    }
  } else if (
    environment.provider !== undefined &&
    !Object.prototype.hasOwnProperty.call(config.providers, environment.provider)
  ) {
    // No local secret, but an explicit provider name was given that doesn't exist:
    // still an error — a named provider must resolve.
    throw new KeyshelfError(
      "PROVIDER_NOT_FOUND",
      `Environment '${shelf}/${name}' references undefined provider '${environment.provider}'.`,
      { ...where, provider: environment.provider }
    );
  }

  for (const key of Object.keys(environment.keys)) {
    if (!KEY_NAME_PATTERN.test(key)) {
      throw new KeyshelfError(
        "INVALID_KEY_NAME",
        `Key '${key}' in '${shelf}/${name}' is not a valid env-var identifier (expected ${KEY_NAME_PATTERN}).`,
        { ...where, key }
      );
    }

    if (!Object.prototype.hasOwnProperty.call(schema.keys, key)) {
      throw new KeyshelfError(
        "UNKNOWN_KEY",
        `Key '${key}' is not declared in the schema for shelf '${shelf}'.`,
        { ...where, key }
      );
    }
  }

  for (const [key, declared] of Object.entries(schema.keys)) {
    if (
      declared.kind === "required" &&
      !Object.prototype.hasOwnProperty.call(environment.keys, key)
    ) {
      throw new KeyshelfError(
        "MISSING_REQUIRED",
        `Required key '${key}' is missing from environment '${shelf}/${name}'.`,
        { ...where, key }
      );
    }
  }
}

/**
 * The single dependency static reference validation needs: load a referenced
 * `{shelf}/{stage}` environment from the **filesystem only**. There is no adapter
 * here by design — a `!ref` is checked structurally (target shelf/stage/key
 * present, one hop), never resolved through a provider — so "no backend access"
 * (ADR-0007, issue #203) is structural, not merely a convention.
 */
export interface ReferenceValidationDeps {
  /**
   * Load a referenced target environment. Throws the loader's structural codes
   * (`SHELF_NOT_FOUND`, `SCHEMA_NOT_FOUND`, `ENVIRONMENT_NOT_FOUND`,
   * `MALFORMED_FILE`) when the target shelf/stage cannot be loaded.
   */
  loadReference(shelf: string, stage: string): Promise<LoadedEnvironment>;
}

/**
 * Statically validate every `!ref` in a loaded environment, **offline** — no
 * backend access (ADR-0007). For each key `K: !ref { shelf: S, key: T, stage: G }`
 * (with `T` defaulting to `K` and `G` to the current stage), it loads the target
 * `S/{G}.yaml` from the filesystem and confirms the reference would resolve in
 * principle:
 *
 * - **Check 2** target shelf `S` exists,
 * - **Check 3** target stage `G` exists (`S/{G}.yaml` present),
 * - **Check 4** target key `T` is declared in `S`'s schema,
 * - **Check 5** `T` is present in the target environment (supplied, or covered by
 *   a schema config default),
 * - **Check 6** `T`'s representation is config or `!secret`, not another `!ref`
 *   (one hop only).
 *
 * Checks 2–5 fail with `REFERENCE_NOT_FOUND`; check 6 (and a structurally
 * malformed `!ref` with no parsed payload) fails with `INVALID_REFERENCE`. Check 1
 * (the consuming key is declared, and a `!ref` discharges `!required`) is the
 * closed-contract rule already enforced by {@link validateEnvironment}.
 *
 * Throws the first {@link KeyshelfError} it finds; resolves when every `!ref` is
 * sound. A target `!secret` is **confirmed to be a secret, never fetched** — the
 * value's resolvability at the backend is a `run`-time concern out of scope here.
 */
export async function validateReferences(
  loaded: LoadedEnvironment,
  deps: ReferenceValidationDeps
): Promise<void> {
  const { environment } = loaded;
  for (const [key, value] of Object.entries(environment.keys)) {
    if (value.kind !== "ref") continue;
    await validateReference(key, value, environment.name, deps);
  }
}

/** Validate one `!ref` key (checks 2–6) against the filesystem-loaded target. */
async function validateReference(
  consumingKey: string,
  value: EnvironmentValue,
  currentStage: string,
  deps: ReferenceValidationDeps
): Promise<void> {
  // The loader never produces a ref-kind value without a parsed reference; guard
  // anyway so a malformed payload is INVALID_REFERENCE rather than a crash.
  const reference: KeyReference | undefined = value.reference;
  if (reference === undefined) {
    throw new KeyshelfError(
      "INVALID_REFERENCE",
      `Key '${consumingKey}' has a malformed !ref (no shelf/key/stage payload).`,
      { key: consumingKey }
    );
  }

  const targetKey = reference.key ?? consumingKey;
  const targetStage = reference.stage ?? currentStage;
  const targetId = `${reference.shelf}/${targetStage}`;
  const where = { key: consumingKey, target: `${targetId}#${targetKey}` };

  // Checks 2 & 3: target shelf and stage exist (loader maps both to its codes).
  let target: LoadedEnvironment;
  try {
    target = await deps.loadReference(reference.shelf, targetStage);
  } catch (error) {
    if (error instanceof KeyshelfError) {
      throw new KeyshelfError(
        "REFERENCE_NOT_FOUND",
        `Key '${consumingKey}' references '${where.target}', but ${targetId} could not be loaded: ${error.message}`,
        { ...where, cause: error.code }
      );
    }
    throw error;
  }

  // Checks 4 & 5: the target key is declared in the target schema and supplied
  // (an env value, or a schema config default). targetEnvironmentValue folds both.
  const resolved = targetEnvironmentValue(target, targetKey);
  if (resolved === undefined) {
    throw new KeyshelfError(
      "REFERENCE_NOT_FOUND",
      `Key '${consumingKey}' references '${where.target}', but that key is not declared or supplies no value there.`,
      where
    );
  }

  // Check 6: one hop only — the target must land on config or secret, never a !ref.
  if (resolved.kind === "ref") {
    throw new KeyshelfError(
      "INVALID_REFERENCE",
      `Key '${consumingKey}' references '${where.target}', which is itself a !ref (one hop only).`,
      where
    );
  }
}

/**
 * The effective value a target environment supplies for a key, for static
 * validation: its environment entry if present, otherwise the shelf schema's
 * config default. `undefined` when the key is neither declared-with-a-default nor
 * supplied — a dangling reference (checks 4 & 5 fold into this one lookup).
 */
function targetEnvironmentValue(
  target: LoadedEnvironment,
  key: string
): EnvironmentValue | undefined {
  const supplied = target.environment.keys[key];
  if (supplied !== undefined) return supplied;

  const declared = target.schema.keys[key];
  if (declared?.kind === "config" && declared.default !== undefined) {
    return { kind: "config", value: declared.default };
  }

  return undefined;
}
