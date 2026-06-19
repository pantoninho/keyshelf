import {type Document, isMap, Scalar, YAMLMap} from 'yaml'

/**
 * The form a `!secret` reference takes in the environment file. The adapter's
 * `write` returns the canonical stored name; when that name matches the
 * convention the adapter would resolve by default, the environment records a
 * *bare* `!secret` (the value lives in the store under the convention name).
 * Anything else — a foreign/explicit name, or a non-string payload — is recorded
 * verbatim as `!secret { ref: ... }` so it round-trips back through the loader.
 */
export type SecretRefForm = {bare: true} | {bare: false; ref: unknown}

/**
 * Decide how to record a written secret's reference. `adapterRef` is whatever
 * `Adapter.write` returned; `conventionRef` is the name the environment's
 * adapter would resolve by convention for this key. They match (or the adapter
 * returned `undefined`) ⇒ a bare `!secret`; otherwise the foreign reference is
 * carried explicitly.
 */
export function secretRefForm(adapterRef: unknown, conventionRef: string): SecretRefForm {
  if (adapterRef === undefined || adapterRef === conventionRef) {
    return {bare: true}
  }

  return {bare: false, ref: adapterRef}
}

/**
 * Find or create the top-level `keys:` mapping of an environment document,
 * mutating the document in place. Surgical: the `provider:` line, comments, and
 * every other key are left untouched.
 */
function keysMap(doc: Document): YAMLMap {
  const top = doc.contents
  if (!isMap(top)) {
    // An environment with no mapping (or only a provider that parsed oddly) is a
    // caller bug here — the loader has already accepted the file as a mapping.
    throw new Error('environment document is not a mapping')
  }

  const existing = top.get('keys', true)
  if (isMap(existing)) {
    return existing
  }

  const created = new YAMLMap()
  top.set('keys', created)
  return created
}

/**
 * Set `KEY` to a plaintext value under `keys:`, in place. Overwrites any prior
 * value — including a prior `!secret` tag — with a plain scalar, and preserves
 * every other key and the `provider:` line. The value is stored as a string;
 * the `yaml` library quotes/escapes it as needed so adversarial values
 * (spaces, `=`, quotes, newlines) round-trip byte-exactly.
 */
export function setConfigValue(doc: Document, key: string, value: string): void {
  keysMap(doc).set(key, new Scalar(value))
}

/**
 * Record `KEY` as a `!secret` reference under `keys:`, in place — never the
 * value. A bare form writes a tagged null scalar (`KEY: !secret`); an explicit
 * form writes a tagged mapping (`KEY: !secret { ref: ... }`). Both parse back
 * through the loader's `!secret` handling.
 */
export function setSecretRef(doc: Document, key: string, form: SecretRefForm): void {
  const map = keysMap(doc)

  if (form.bare) {
    const scalar = new Scalar(null)
    scalar.tag = '!secret'
    map.set(key, scalar)
    return
  }

  const node = doc.createNode({ref: form.ref}) as YAMLMap
  node.tag = '!secret'
  map.set(key, node)
}
