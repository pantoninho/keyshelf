# Keyshelf — Build Reference

The committed contract surface for the MVP. Rationale lives in `docs/adr/`;
vocabulary in `../CONTEXT.md`. This file is _what_, not _why_. Coming from
keyshelf v5? See [Migrating from v5](./migrating-from-v5.md).

## File layout

```
.keyshelf/
├── config.yaml                     # project + providers (required)
└── {shelf}/                        # one shelf per schema
    ├── schema.yaml                 # the shelf's closed validation contract
    ├── {stage}.yaml                # an environment implementing the shelf's schema
    └── {stage}.secrets.yaml        # sops store for that environment (encrypted; committed)
```

Identity is **filesystem-derived**: the shelf is its directory name, the
environment is its filename (the stage), the schema is the shelf's `schema.yaml`.
No `name:` or `schema:` fields anywhere. An environment is addressed as
`{shelf}/{stage}` (e.g. `web-service/staging`).

## config.yaml

```yaml
project: myapp # required; namespaces secrets in shared backends
providers:
  local:
    adapter: sops # only required field for sops
    # store: "{shelf}/{stage}.secrets.yaml"   # optional layout override (default shown)
  gcp-staging:
    adapter: gcp
    projectId: my-gcp-proj-stg # required; adapter fields never reuse `project`
    # location: global              # optional; absent/global ⇒ automatic replication,
    # else user-managed replication pinned to that region
```

- A provider entry is a named map with an `adapter:` discriminator plus
  adapter-specific fields. Providers are project-global.
- Reference adapters (e.g. `gcp`) name remote secrets by the **fixed** convention
  `keyshelf__{project}__{shelf}__{stage}__{key}`. No configurable template; the only override is
  a per-key explicit reference. A missing required adapter field (e.g. `gcp`'s
  `projectId`) is a `MALFORMED_FILE`.

## {shelf}/schema.yaml

```yaml
keys:
  LOG_LEVEL: info # config default — overridable
  REGION: !required # must be supplied by every environment


  FEATURE_X: !optional # may be supplied; absence is OK


  DATABASE_PASSWORD: !required # presence only — secret-ness is the environment's call

```

Presence only — `default value` / `!required` / `!optional`. Never decides
plaintext vs secret. Closed contract: environments may only use declared keys.

## {shelf}/{stage}.yaml

```yaml
provider: gcp-staging # references a provider in config.yaml
keys:
  LOG_LEVEL: debug # plaintext config (overrides schema default)
  REGION: eu-west-1 # required, supplied plaintext
  DATABASE_PASSWORD: !secret # convention: value lives in the store under this key


  DATABASE_URL: !secret { ref: ... } # explicit reference (foreign/pre-existing secret)
```

- No `schema:` field — the environment is implicitly bound to its shelf's schema.
- Each value's **representation** (plaintext vs `!secret`) is chosen here, per
  environment. The same key may be plaintext in one environment and `!secret` in
  another.
- Values are **strings** only.
- Secret _values_ never appear here — only `!secret` references. Values live in
  the adapter's store (sops: `{shelf}/{stage}.secrets.yaml`; gcp: the backend).
- `!secret` payload shape is adapter-defined; bare = convention, optional explicit
  `{ ref: ... }` overrides.

## Key references (`!ref`)

A key's **third representation**, alongside plaintext config and `!secret`. Instead
of supplying a value, a key reference points at another key — letting a value be
**declared once** in a canonical shelf and pulled into any environment that needs
it. Written as a mapping under the `!ref` tag:

```yaml
provider: local # optional: an environment of only config + !ref needs no provider
keys:
  DATABASE_URL: !ref { shelf: shared } # same key name, current stage
  API_TOKEN: !ref { shelf: shared, key: SHARED_API_TOKEN } # rename the target key
  AUDIT_KEY: !ref { shelf: shared, stage: production } # cross a stage
```

Fields:

- `shelf` — **required**. The shelf the target key lives in.
- `key` — optional; defaults to the **consuming key's own name** (same-name is the
  common case; supply it to map a differently-named target key).
- `stage` — optional; defaults to the **current stage** (the stage being run;
  supply it to resolve the target at a different stage).

Resolution (at `run`/`validate`, in `resolve.ts`, above the adapter seam):

- **Lazy, single-key.** The target shelf's `schema.yaml` and `{shelf}/{stage}.yaml`
  are loaded and **only** the referenced key is resolved — never the whole target
  environment.
- **Through the target's own provider.** The value lives in the target
  environment's store, so a `!secret` target resolves via the **target**
  environment's provider — this is what makes a value shared across two different
  backends (a sops shelf can reference into a fake/gcp shelf and vice versa).
- **Representation-transparent.** A reference lands on whatever the target key is —
  plaintext config or a `!secret` — and yields its resolved value.
- **One hop only.** A key reference must land on a config or a secret. Landing on
  another `!ref` is a runtime `INVALID_REFERENCE` (resolution never recurses or
  chains, so cycles are impossible by construction).
- **Missing target.** If the target shelf, stage, or key does not exist (or the key
  exists in the schema but the target environment supplies no value for it), the
  reference fails with `REFERENCE_NOT_FOUND`.

The principal running `keyshelf run` must have read access to every referenced
environment's store (e.g. the ability to decrypt the canonical sops file), since
the value resolves through the target's provider.

## CLI surface (MVP)

Built on **oclif**. The qualified environment `{shelf}/{stage}` is a positional
argument.

| Command                                             | Purpose                                                                                                                                                                                                                                               |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keyshelf init [--project <name>] [--shelf <name>]` | Scaffold `.keyshelf/` (non-interactive; project defaults to cwd name; creates `config.yaml` with a default `local` sops provider and a starter shelf — `--shelf`, default `app` — with an empty `schema.yaml`). Refuses to clobber without `--force`. |
| `keyshelf set <KEY> <shelf>/<stage> [--secret]`     | Write a value. Read from stdin/prompt, never argv. `--secret` → store + write a `!secret` reference; plaintext → environment file. Key must already be in the shelf's schema; never mutates the schema.                                               |
| `keyshelf run <shelf>/<stage> -- <cmd>`             | Resolve config + secrets into env vars, overlay the inherited environment, exec `<cmd>`. Fail-fast: aborts before exec if anything is unresolvable.                                                                                                   |
| `keyshelf validate [<shelf>/<stage>]`               | Run the same closed-contract + resolution checks as `run`, execute nothing, emit structured results. Validates the whole project when the argument is omitted.                                                                                        |

Conventions:

- Every command supports `--json` (covers **output and errors**).
- `--help` on every command is the agent-facing discovery surface; oclif also
  emits a machine-readable command manifest (`oclif.manifest.json`).
- Exit status is **success/failure only**; granularity lives in `error.code`.

### run resolution & precedence

1. Merge schema defaults ← environment values.
2. Resolve every `!secret` through the environment's provider.
3. Produce a flat `string→string` map; keys are env-var names verbatim
   (validated `^[A-Z_][A-Z0-9_]*$`).
4. Precedence, highest to lowest: explicit `--set KEY=VALUE` → keyshelf's
   resolved value → inherited ambient env (only for keys keyshelf doesn't manage).

## Errors

JSON shape: `{ "error": { "code": <CODE>, "message": <string>, ...fields } }`,
with fields such as `key`, `shelf`, `environment`, `file` as relevant.

Closed code set (additive growth OK; renames are breaking):

| Code                    | Meaning / caller action                                                |
| ----------------------- | ---------------------------------------------------------------------- |
| `NOT_INITIALIZED`       | No `.keyshelf/` found → run `init`                                     |
| `ALREADY_INITIALIZED`   | `init` on existing project → `--force` or skip                         |
| `SHELF_NOT_FOUND`       | Addressed shelf directory does not exist                               |
| `SCHEMA_NOT_FOUND`      | Shelf has no `schema.yaml`                                             |
| `ENVIRONMENT_NOT_FOUND` | Named environment file missing in the shelf                            |
| `PROVIDER_NOT_FOUND`    | Environment references an undefined provider                           |
| `UNKNOWN_KEY`           | Environment key not declared in the shelf's schema                     |
| `MISSING_REQUIRED`      | A `!required` key is absent                                            |
| `INVALID_KEY_NAME`      | Key is not a valid env-var identifier                                  |
| `ADAPTER_UNAVAILABLE`   | Backend prerequisite missing (e.g. sops not found)                     |
| `PROVIDER_AUTH`         | Backend authentication/credential failure                              |
| `SECRET_NOT_FOUND`      | Referenced secret absent from the store                                |
| `REFERENCE_NOT_FOUND`   | A `!ref` target shelf/stage/key does not exist or supplies no value    |
| `INVALID_REFERENCE`     | A `!ref` is malformed, or its target is itself a `!ref` (one hop only) |
| `NO_INPUT`              | `set` received no value on stdin                                       |
| `MALFORMED_FILE`        | Unparseable/invalid config, schema, or environment (`file` + `reason`) |
| `ADAPTER_ERROR`         | Other backend op failure (decrypt, network, write)                     |
| `EXEC_FAILED`           | `run` resolved but could not start the wrapped command                 |

## Distribution & the sops binary

Keyshelf ships its `sops` binary the way esbuild/Biome ship theirs: as five
per-platform **optional dependency** packages (ADR-0003). One
`npm i -g keyshelf` pulls in exactly one of them — the one whose `os`/`cpu`
matches the host — and nothing else; the user never installs sops separately.
See `docs/distribution.md` for the full model, the versioning decision, the
build/integrity pipeline, and the two-tier no-publish verification.

`resolveSopsBinary()` resolves the binary in this order:

1. **`KEYSHELF_SOPS_BIN`** — an explicit override (absolute path to a `sops`
   binary). Used by tests to point at a throwaway/broken binary; also the escape
   hatch for a user who wants their own sops. A path that does not exist is
   `ADAPTER_UNAVAILABLE` (never a raw spawn error).
2. The **bundled** `@keyshelf/sops-{platform}-{arch}` package for this host, if
   installed (located via `require.resolve`, binary at `bin/sops[.exe]`).
3. Any **`sops` on `PATH`** — the fallback that makes a hermetic CI runner (with a
   pinned real sops) work without the platform packages being published.

If none resolve, the sops adapter surfaces `ADAPTER_UNAVAILABLE` naming the
platform package and the PATH fallback.

> **No-publish status.** The platform packages are **not yet published** to npm.
> The build + verification pipeline and a **gated** publish workflow exist, but
> until the first human-driven publish, real installs rely on the PATH fallback
> (which is why CI still installs a pinned sops/age). See `docs/distribution.md`.

## Testing

Tooling: **vitest**, real temp directories, **TDD against this document**. See
ADR-0005 for rationale.

- **Unit** — pure logic: validation, default←environment merge, key-name regex,
  precedence, resolution planning.
- **Conformance** — two shared, adapter-agnostic suites run as a matrix over every
  adapter via a small per-adapter harness (provider config + backend
  setup/teardown):
  - _Adapter-contract suite_ — exercises `resolve`/`write` directly.
  - _Black-box E2E suite_ — spawns the real `keyshelf` binary; asserts `--json`
    output, exit status, file effects, and the env a wrapped command sees.

  Both enforce two cross-cutting dimensions: **error-code mapping** (every adapter
  maps the same conditions to the same codes above) and **value fidelity**
  (byte-exact round-trip of adversarial values — newlines, whitespace, `=`,
  quotes, unicode, multi-KB, empty).

Matrix execution:

| Adapter            | When                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `fake` (in-memory) | every PR — hermetic, fast lane, keeps the fake faithful                                                                  |
| `sops`             | every PR — hermetic (sops bundled)                                                                                       |
| `gcp`              | gated — real GCP infra, credentials + opt-in only (e.g. nightly on `main`), unique `{project}` prefix per run + teardown |

A new adapter ships a harness and must pass both suites, including the
error-mapping and value-fidelity dimensions.

E2E coverage (adapter-agnostic scenarios): lifecycle (`init`, `--force`,
refuse-clobber) · `set` (config + secret, stdin, schema enforcement, unknown-key
rejection) · secret round-trip · `run` (merge, precedence, augment, fail-fast
no-exec, child exit-code propagation) · `validate` (per-shelf and whole-project,
every failure mode) · multi-shelf addressing · every error code triggered.
