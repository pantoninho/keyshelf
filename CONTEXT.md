# Keyshelf

A CLI tool for managing application config and secrets. It stores and fetches
values through pluggable backends, and validates that each environment conforms
to a declared shape. There is no web UI; the CLI is the only interface, designed
to be discoverable by both humans and coding agents.

## Language

**Project**:
The required top-level name declared in `config.yaml`. Identifies the
keyshelf-managed project and namespaces secrets within shared provider backends
(composed with the environment into a remote secret's name). Inert for the sops
adapter; load-bearing for reference adapters.
_Avoid_: app, workspace, repo

**Shelf**:
A named bundle of exactly one schema (`schema.yaml`) and the environments that
implement it, living in its own directory under `.keyshelf/`. Multiple schemas in
a project means multiple shelves. A shelf's name is its directory name.
_Avoid_: group, namespace, bundle, module

**Adapter**:
The implementation that talks to one type of backend (sops, gcp). Defines _how_
values are stored and fetched for that backend type.
_Avoid_: driver, plugin, backend (backend is the external system, not the code)

**Provider**:
A configured instance of an adapter, declared in `config.yaml` and referenced by
name (e.g. `gcp-staging`). A provider is an adapter plus its configuration.
Providers are project-global; environments in any shelf may reference them.
_Avoid_: connection, source

**Schema**:
The declared shape of the environments in a shelf, held in the shelf's
`schema.yaml`: which keys may exist and each key's presence requirement — a
default value, `!required`, or `!optional`. A schema governs presence only; it
does not decide whether a value is plaintext or secret. It is a closed contract
(an environment may only use keys the schema declares). Exactly one schema per
shelf.
_Avoid_: template, spec, type

**Stage**:
A deployment name shared across shelves (e.g. `dev`, `staging`, `production`). A
stage is not itself an environment; paired with a shelf it identifies one. The
same stage recurs across shelves — `backend/production` and `mobile/production`
share the `production` stage but are distinct environments.
_Avoid_: env, env slug, tier

**Environment**:
A shelf at a stage: the implementation of a shelf's schema for one stage, held in
`{shelf}/{stage}.yaml`. Supplies the actual values (and a provider when it holds a
local secret). Implicitly bound to its shelf's schema (no schema reference field).
Addressed as `{shelf}/{stage}` (e.g. `backend/production`).
_Avoid_: env, target

**Key**:
A single named entry, declared in a schema and given a value in an environment.
A key's _representation_ (config, secret, or key reference) is chosen per
environment, not fixed by the schema.
_Avoid_: field, variable, entry

**Config (value)**:
The plaintext representation of a key's value in an environment. Lives in files
(schema defaults and environment values) and is committed to the repo.
_Avoid_: setting, parameter

**Secret (value)**:
The sensitive representation of a key's value in an environment, marked with the
`!secret` tag. Never stored in plaintext in the repo; resolved through a provider.
The same key may be config in one environment and secret in another.
_Avoid_: credential, password

**Store**:
Where an adapter physically persists secret values, always outside the
environment file. For the sops adapter, a sibling encrypted file
(`{shelf}/{env}.secrets.yaml`); for a remote adapter (gcp), the backend itself.
The environment file holds `!secret` references _into_ the store, never the values.
_Avoid_: vault, backend, storage

**Reference**:
A pointer in an environment file to where a value actually lives, instead of an
inline value. The genus of two kinds: a _store reference_ and a _key reference_.
_Avoid_: pointer, link, handle

**Store reference**:
The pointer a Secret holds into its adapter store, resolved _by the adapter_. Its
shape is adapter-defined — by convention a bare `!secret` (the key name locates
the value), or an explicit `ref` locator for foreign/pre-existing secrets that
some adapters accept. A `ref` is an adapter parameter, not a first-class concept.
_Avoid_: secret ref, locator

**Key reference**:
A key's third representation (alongside config and secret), marked `!ref`. Instead
of supplying a value, it points at another key in keyshelf coordinates —
`!ref { shelf, key }`, resolving at the _current stage_ by default, with an
optional `stage` to cross stages. Resolved by re-resolving the target key,
landing transparently on whatever representation that key has (config or secret).
_Avoid_: alias, link, import
