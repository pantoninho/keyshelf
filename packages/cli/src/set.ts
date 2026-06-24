import { type Document, isMap, Scalar, YAMLMap } from "yaml";
import type { KeyReference } from "./model.js";

/**
 * The form a `!secret` reference takes in the environment file. The adapter's
 * `write` returns the canonical stored name; when that name matches the
 * convention the adapter would resolve by default, the environment records a
 * *bare* `!secret` (the value lives in the store under the convention name).
 * Anything else — a foreign/explicit name, or a non-string payload — is recorded
 * verbatim as `!secret { ref: ... }` so it round-trips back through the loader.
 */
export type SecretRefForm =
  | { bare: true; version?: number }
  | { bare: false; ref: unknown; version?: number };

/**
 * Decide how to record a written secret's reference. `adapterRef` is whatever
 * `Adapter.write` returned (its `ref`); `conventionRef` is the name the
 * environment's adapter would resolve by convention for this key. They match (or
 * the adapter returned `undefined`) ⇒ a bare `!secret`; otherwise the foreign
 * reference is carried explicitly.
 *
 * `version` is the concrete backend version `write` reported (ADR-0009). When
 * present it is recorded as a pin (`!secret { version: N }` or
 * `!secret { ref: NAME, version: N }`); when `undefined` the reference floats
 * (resolves `latest`), as adapters that do not version their store report.
 */
export function secretRefForm(
  adapterRef: unknown,
  conventionRef: string,
  version?: string
): SecretRefForm {
  const pin = version === undefined ? {} : { version: Number.parseInt(version, 10) };
  if (adapterRef === undefined || adapterRef === conventionRef) {
    return { bare: true, ...pin };
  }

  return { bare: false, ref: adapterRef, ...pin };
}

/**
 * Find or create the top-level `keys:` mapping of an environment document,
 * mutating the document in place. Surgical: the `provider:` line, comments, and
 * every other key are left untouched.
 */
function keysMap(doc: Document): YAMLMap {
  const top = doc.contents;
  if (!isMap(top)) {
    // An environment with no mapping (or only a provider that parsed oddly) is a
    // caller bug here — the loader has already accepted the file as a mapping.
    throw new Error("environment document is not a mapping");
  }

  const existing = top.get("keys", true);
  if (isMap(existing)) {
    return existing;
  }

  const created = new YAMLMap();
  top.set("keys", created);
  return created;
}

/**
 * Set `KEY` to a plaintext value under `keys:`, in place. Overwrites any prior
 * value — including a prior `!secret` tag — with a plain scalar, and preserves
 * every other key and the `provider:` line. The value is stored as a string;
 * the `yaml` library quotes/escapes it as needed so adversarial values
 * (spaces, `=`, quotes, newlines) round-trip byte-exactly.
 */
export function setConfigValue(doc: Document, key: string, value: string): void {
  keysMap(doc).set(key, new Scalar(value));
}

/**
 * Record `KEY` as a `!secret` reference under `keys:`, in place — never the
 * value. A bare form writes a tagged null scalar (`KEY: !secret`); an explicit
 * form writes a tagged mapping (`KEY: !secret { ref: ... }`). Both parse back
 * through the loader's `!secret` handling.
 */
export function setSecretRef(doc: Document, key: string, form: SecretRefForm): void {
  const map = keysMap(doc);

  // A bare, floating !secret is a tagged null scalar; anything with a payload
  // (an explicit foreign ref and/or a pinned version, ADR-0009) is a tagged
  // mapping carrying only the fields the form supplies, in ref → version order.
  if (form.bare && form.version === undefined) {
    const scalar = new Scalar(null);
    scalar.tag = "!secret";
    map.set(key, scalar);
    return;
  }

  const payload: Record<string, unknown> = {};
  if (!form.bare) payload.ref = form.ref;
  if (form.version !== undefined) payload.version = form.version;

  const node = doc.createNode(payload) as YAMLMap;
  node.tag = "!secret";
  map.set(key, node);
}

/**
 * Record `KEY` as a `!ref` key reference under `keys:`, in place (ADR-0007) —
 * never a value. Writes a tagged mapping `KEY: !ref { shelf, [key], [stage] }`
 * that parses back through the loader's `!ref` handling. `shelf` is always
 * written; `key` and `stage` are written only when present on `reference`, so the
 * caller is responsible for omitting `key` when the target name equals the
 * consuming key (same-name is the loader's default) and `stage` for the current
 * stage. Overwrites any prior value, including a `!secret`, and preserves every
 * other key and the `provider:` line.
 */
export function setKeyReference(doc: Document, key: string, reference: KeyReference): void {
  // Build the payload in field order shelf → key → stage, omitting absent
  // optionals so the written node carries only what the author specified.
  const payload: Record<string, string> = { shelf: reference.shelf };
  if (reference.key !== undefined) payload.key = reference.key;
  if (reference.stage !== undefined) payload.stage = reference.stage;

  const node = doc.createNode(payload) as YAMLMap;
  node.tag = "!ref";
  keysMap(doc).set(key, node);
}
