# Schemas as closed validation contracts, organized into shelves

## Decision

Schemas and environments are organized into **shelves**: each shelf is a directory
under `.keyshelf/` holding exactly one `schema.yaml` and the environments
(`{env}.yaml`) that implement it. Multiple schemas in a project means multiple
shelves. An environment is addressed as `{shelf}/{env}` and is **implicitly bound**
to its shelf's schema — there is no schema-reference field.

A schema is a **closed contract**: an environment may only use keys the schema
declares, and validation fails before `run` on any undeclared key, missing
required key, or dangling provider reference.

The schema governs **presence only** — each declared key is one of:

- a default value (config, overridable),
- `!required` (must be supplied), or
- `!optional` (may be supplied, absence is OK).

Whether a key's value is plaintext config or a `!secret` is decided **per
environment**, not by the schema. Presence (schema) and representation
(environment) are orthogonal axes. The same key may be plaintext in one
environment and a secret in another.

## Why

We started from Pulumi-ESC-style one-level inheritance (`_base → dev/staging/prod`)
and rejected it. Inheritance forced a base file to hold secret _values_ that a
child environment would then have to resolve through a _different_ provider —
an ambiguity with no clean answer. Schemas dissolve it: the schema holds no
secret values, only declarations, so every environment supplies and resolves its
own secrets through its own provider. Inheritance is replaced by "implement this
shape," which also makes validation a real, first-class feature — the property
that matters for an agent-first CLI.

Shelves bundle a schema with its environments so the schema binding is
_structural_ (directory membership) rather than a field that can drift. This
keeps the "multiple schemas per project" capability while removing the
schema-reference field entirely; identity is wholly filesystem-derived.

Closed (not open) because the entire point of a schema is to catch drift and
typos before `run`; a schema environments can freely escape validates nothing.

Orthogonal presence/representation (rather than the schema fixing each key's
config-vs-secret kind) because real keys change sensitivity across environments —
`DATABASE_URL` is a harmless localhost string in dev but a credential-bearing
secret in prod.

## Consequences

We knowingly gave up the schema's ability to enforce "this key must _never_
appear in plaintext, anywhere." A key that should always be secret (a signing
key) can be written as plaintext in some environment and validation will pass.
We accepted this for the per-environment flexibility above; an opt-in
always-secret marker was considered and deliberately left out of the MVP.
