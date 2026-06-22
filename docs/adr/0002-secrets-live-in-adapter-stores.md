# Secret values live in adapter-owned stores; environment files hold references

## Decision

Secret _values_ are never written into the environment file. Each adapter owns a
**store** where it persists values, and the environment file's `keys:` map holds
only a `!secret` **reference** into that store. The reference's payload shape is
adapter-defined, and resolves by convention by default (the key name locates the
value) with an optional explicit reference for foreign/pre-existing secrets.

- **sops adapter:** the store is a per-environment sibling encrypted file
  (`{shelf}/{stage}.secrets.yaml`); recipients are governed by the project's
  native `.sops.yaml`, not by keyshelf.
- **reference adapters (gcp, aws):** the store is the remote backend; the
  reference is a pointer (ARN / resource path).

Adapters implement a two-method contract — `resolve(key, ref) → string` and
`write(key, value) → ref` — and are the only place backend-specific code lives.
Authentication is delegated to each backend's native credential mechanism.

## Why

The original design put encrypted/secret material inline in the environment file.
Separating the _reference_ (committed, readable manifest) from the _value_
(in the store) keeps environment files clean, diffable, and free of sensitive
material, and unifies the two adapter archetypes — inline-encrypted (sops) and
remote (gcp) — behind one model: the environment file always references, the store always
holds the value.

Recipients are delegated to `.sops.yaml` rather than reinvented in keyshelf
config because adapters should use the backend's native mechanism; sops already
has a mature, widely-understood key-resolution system, and duplicating it would
invite drift.

## Consequences

Keyshelf does not manage sops recipients — adding or rotating who can decrypt is
done by editing `.sops.yaml` and re-encrypting, outside keyshelf. `delete`,
`list`, and `rotate` are not part of the adapter contract in the MVP; nothing in
the `set`/`run` loop needs them.
