import { KeyshelfError } from "../errors.js";

/**
 * Helpers shared verbatim across the concrete adapters (fake, gcp, sops). They
 * were previously copy-pasted per adapter; centralizing them keeps the
 * convention-naming and `!secret` ref-coercion rules identical everywhere, which
 * is exactly what the adapter contract (ADR-0005) requires.
 */

/** Compose the convention stored-name for a key: `{namespace}__{key}` (bare key when unnamespaced). */
export function conventionName(namespace: string, key: string): string {
  return namespace === "" ? key : `${namespace}__${key}`;
}

/**
 * Coerce an explicit `!secret` ref payload to the stored name string. Accepts a
 * bare string or a `{ ref: string }` object; anything else is an `ADAPTER_ERROR`
 * tagged with the calling adapter's name.
 */
export function refName(adapterName: string, ref: unknown): string {
  if (typeof ref === "string") return ref;
  if (
    ref &&
    typeof ref === "object" &&
    "ref" in ref &&
    typeof (ref as { ref: unknown }).ref === "string"
  ) {
    return (ref as { ref: string }).ref;
  }

  throw new KeyshelfError(
    "ADAPTER_ERROR",
    `${adapterName} adapter: unsupported !secret ref payload: ${JSON.stringify(ref)}`,
    { ref }
  );
}

/**
 * Extract the pinned `version` from a `!secret` ref payload, if any (ADR-0009).
 * Accepts `{ version: N }` or `{ ref: NAME, version: N }`; a bare string ref or a
 * payload with no `version` floats (returns `undefined`). The loader has already
 * validated a present `version` as a positive integer, so this just reads it.
 */
export function refVersion(ref: unknown): number | undefined {
  if (ref && typeof ref === "object" && "version" in ref) {
    const version = (ref as { version: unknown }).version;
    if (typeof version === "number") return version;
  }

  return undefined;
}

/** Whether a `!secret` ref payload carries an explicit foreign name (vs only a pin). */
export function hasExplicitName(ref: unknown): boolean {
  if (typeof ref === "string") return true;
  return Boolean(ref && typeof ref === "object" && typeof (ref as { ref?: unknown }).ref === "string");
}

/** The first non-empty line of a multi-line diagnostic, for terse messages. */
export function firstLine(text: string): string {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }

  return "";
}
