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
The implementation that talks to one type of backend (sops, gcp). Defines *how*
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

**Environment**:
An implementation of its shelf's schema, held in `{shelf}/{env}.yaml`. Supplies a
provider and the actual values. Implicitly bound to its shelf's schema (no schema
reference field). Addressed as `{shelf}/{env}` (e.g. `web-service/staging`).
_Avoid_: stage, env (in prose), target

**Key**:
A single named entry, declared in a schema and given a value in an environment.
A key's *representation* (plaintext config vs. secret) is chosen per environment,
not fixed by the schema.
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
The environment file holds `!secret` references *into* the store, never the values.
_Avoid_: vault, backend, storage

**Reference**:
The pointer held by a `!secret` entry in the environment file that locates a
value in the store. Its shape is adapter-defined.
_Avoid_: pointer, link, handle
