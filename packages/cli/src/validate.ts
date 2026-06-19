import { KeyshelfError } from "./errors.js";
import type { LoadedEnvironment } from "./model.js";

/** The canonical env-var identifier rule (docs/reference.md). */
const KEY_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

/**
 * Validate a single loaded environment against the closed-contract and presence
 * rules. Pure logic, no I/O — the loader has already turned files into the model.
 *
 * Checks, in order:
 * 1. The referenced provider exists in `config.providers`  → `PROVIDER_NOT_FOUND`
 * 2. Every key name is a valid env-var identifier          → `INVALID_KEY_NAME`
 * 3. Every environment key is declared in the schema        → `UNKNOWN_KEY`
 * 4. Every `!required` schema key is supplied               → `MISSING_REQUIRED`
 *
 * Does **not** resolve `!secret` values — a `!secret` entry is structurally fine
 * here. Throws the first {@link KeyshelfError} it finds, carrying the relevant
 * structured fields (`shelf`, `environment`, `key`, `provider`).
 */
export function validateEnvironment(loaded: LoadedEnvironment): void {
  const { config, schema, environment } = loaded;
  const { shelf, name } = environment;
  const where = { shelf, environment: `${shelf}/${name}` };

  if (!Object.prototype.hasOwnProperty.call(config.providers, environment.provider)) {
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
