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
    # ageKeyFile: ".keyshelf/age.key"         # optional; locates the age decryption identity
    #                                         # (relative to project root; ~ and ~/ expand to $HOME;
    #                                         # absolute honored as-is; ADR-0010).
    #                                         # Absent ⇒ ambient SOPS_AGE_KEY_FILE / native sops sources.
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
provider: gcp-staging # references a provider in config.yaml; required iff a local !secret
keys:
  LOG_LEVEL: debug # plaintext config (overrides schema default)
  REGION: eu-west-1 # required, supplied plaintext
  DATABASE_PASSWORD: !secret # convention floating: value lives in the store, resolves latest


  DATABASE_URL: !secret { ref: ... } # explicit reference (foreign/pre-existing secret)
  API_KEY: !secret { version: 8 } # pinned to backend version 8 (deploy-gated, ADR-0009)
  SHARED: !secret { ref: shared-secret, version: 3 } # foreign + pinned
```

- No `schema:` field — the environment is implicitly bound to its shelf's schema.
- `provider:` is **required if and only if** the environment declares at least one
  local `!secret`. An environment whose keys are all plaintext config and/or `!ref`
  key references holds no local secret, so it may omit `provider:` entirely — a
  **mapping environment** (each `!ref` resolves through its _target's_ provider, so a
  local provider would never be used). Declaring a local `!secret` with no
  `provider:` is a `PROVIDER_NOT_FOUND`. Existing environments that declare a
  provider remain valid — this is a relaxation, not a change.
- Each value's **representation** (plaintext vs `!secret`) is chosen here, per
  environment. The same key may be plaintext in one environment and `!secret` in
  another.
- Values are **strings** only.
- Secret _values_ never appear here — only `!secret` references. Values live in
  the adapter's store (sops: `{shelf}/{stage}.secrets.yaml`; gcp: the backend).
- `!secret` payload shape is adapter-defined; bare = convention, optional explicit
  `{ ref: ... }` overrides.
- **Version pinning (ADR-0009).** On a versioned backend (gcp), a `!secret` may pin
  a concrete backend version with `{ version: N }` (or `{ ref: NAME, version: N }`
  for a foreign secret). A **bare `!secret` floats** — it resolves the backend's
  `latest`, so a new value reaches new instances with no deploy and no diff
  (unchanged). A **pinned `!secret` resolves exactly version `N`**, so rotating the
  value becomes a committed env-file diff that gates rollout: the new value can't
  take effect until the manifest change ships. `version` is a positive integer; a
  non-integer or non-positive `version` is a `MALFORMED_FILE`. Pinning is **N/A for
  sops** — its value lives in the committed sibling encrypted file, already
  deploy-gated — and a `version` on a sops `!secret` is inert.

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

### Static validation of key references

`keyshelf validate` checks every `!ref` **statically and offline** — a dangling
or chained reference fails before any `run`, with **no backend access**.
Validation reaches across shelves: it loads the target shelf's `schema.yaml` and
`{shelf}/{stage}.yaml` (filesystem reads only) to confirm the reference would
resolve in principle, but it never resolves the target's value through any
provider (no decrypt, no network — a secret target is confirmed to _be_ a secret,
not fetched).

For a key `K: !ref { shelf: S, key: T, stage: G? }` in the environment being
validated (with `T` defaulting to `K` and `G` to the current stage), validate
runs six checks:

1. `K` is declared in the consuming shelf's schema — the existing closed-contract
   rule (`UNKNOWN_KEY` otherwise). Supplying a `!ref` **discharges** a `!required`
   key, exactly as a config or `!secret` value would.
2. Target shelf `S` exists — else `REFERENCE_NOT_FOUND`.
3. Target stage exists, i.e. `S/{G}.yaml` is present — else `REFERENCE_NOT_FOUND`.
4. Target key `T` is declared in `S`'s schema — else `REFERENCE_NOT_FOUND`.
5. `T` is **present** in the target environment — supplied there, or covered by a
   schema config default — else `REFERENCE_NOT_FOUND`.
6. `T`'s representation is config or `!secret`, **not** another `!ref` (one hop
   only) — else `INVALID_REFERENCE`. A malformed `!ref` payload (e.g. a scalar
   `!ref`, or a missing/empty `shelf`) is also `INVALID_REFERENCE`/`MALFORMED_FILE`
   at load.

Code mapping: checks 2–5 (target shelf/stage/key missing or unsupplied) →
`REFERENCE_NOT_FOUND`; check 6 (target is itself a `!ref`) → `INVALID_REFERENCE`.
Both codes are surfaced in `--json` like every other structured error. Backend
failures (a `!secret` that exists but cannot be fetched, bad creds) are **not**
in scope for these static checks — they keep their `run`-time codes
(`SECRET_NOT_FOUND`, `PROVIDER_AUTH`).

### Authoring a `!ref` with `set --ref`

So that every representation stays CLI-authorable (no hand-editing YAML), `set`
writes a key reference directly:

```
keyshelf set <KEY> <shelf>/<stage> --ref <target-shelf>[/<target-stage>] [--ref-key <target-key>]
```

This is a **pure offline file mutation**: unlike `set --secret`, it reads no value
from stdin, calls no adapter, and requires no provider credentials. It edits the
consuming environment file in place (provider line, comments, and every other key
survive), writing a `!ref` node that round-trips through the loader above.

- `--ref <shelf>` → `!ref { shelf }` — same-name target, current stage.
- `--ref <shelf>/<stage>` → adds an explicit `stage:` — `!ref { shelf, stage }`.
- `--ref-key <target>` → adds a `key:` to rename the target — `!ref { shelf, key }`.
  The `key:` is **omitted** when `<target>` equals the consuming `<KEY>` (a rename
  to the same name is the same-name default, so it is not recorded).
- `--ref` is mutually exclusive with `--secret`; `--ref-key` requires `--ref`.

Examples:

```
# !ref { shelf: supabase }
keyshelf set SUPABASE_SERVICE_ROLE_KEY backend/production --ref supabase

# !ref { shelf: supabase, key: SERVICE_ROLE_KEY }
keyshelf set DB_PASSWORD backend/production --ref supabase --ref-key SERVICE_ROLE_KEY

# !ref { shelf: shared, stage: production }
keyshelf set AUDIT_KEY backend/staging --ref shared/production
```

## CLI surface (MVP)

Built on **oclif**. The qualified environment `{shelf}/{stage}` is a positional
argument.

| Command                                                                                                                      | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keyshelf init [--project <name>] [--shelf <name>]`                                                                          | Scaffold `.keyshelf/` (non-interactive; project defaults to cwd name; creates `config.yaml` with a default `local` sops provider and a starter shelf — `--shelf`, default `app` — with an empty `schema.yaml`). Refuses to clobber without `--force`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `keyshelf set <KEY> <shelf>/<stage> [--secret [--floating] \| --pin-latest \| --ref <shelf>[/<stage>] [--ref-key <target>]]` | Write a value. Read from stdin/prompt, never argv. `--secret` → store + write a `!secret` reference; plaintext → environment file. On a **versioned provider (gcp)** `--secret` **pins the written version by default** (records `version: N`, deploy-gating rotation, ADR-0009); `--floating` opts out (bare `!secret`, resolves latest); a non-versioned provider (sops) always floats. `--pin-latest` re-pins an existing `!secret` to the provider's current latest version **without** changing the value (no stdin read, no new version). `--ref` → author a `!ref` key reference (pure offline file edit, no value read, no provider call). The flags are mutually exclusive. Key must already be in the shelf's schema; never mutates the schema.                                             |
| `keyshelf run <shelf>/<stage> -- <cmd>`                                                                                      | Resolve config + secrets into env vars, overlay the inherited environment, exec `<cmd>`. Fail-fast: aborts before exec if anything is unresolvable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `keyshelf validate [<shelf>/<stage>]`                                                                                        | Run the same closed-contract + resolution checks as `run`, execute nothing, emit structured results. Validates the whole project when the argument is omitted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `keyshelf ls [<shelf>/<stage>]` (alias `keyshelf list`)                                                                      | No argument: print an offline project map — every shelf (sorted), its schema's key count, and its environments (sorted) as a tree; `--json` returns `{ environments: [{ shelf, stage, keys }] }`. With `<shelf>/<stage>`: print that environment's full schema contract — every declared key (in declaration order) with its presence (`required`/`optional`/`default`) and status (`✓ config`/`✓ secret`/`✓ ref → target`/`— default`/`— unset`/`✗ missing`); `--json` returns `{ shelf, stage, keys: [{ key, presence, status, reference?, version?, metadata? }] }` with the raw status enum, the pinned `version` on a pinned secret (ADR-0009), and the offline backend address. A pure file read — builds no provider, contacts no backend, follows no `!ref`, prints no key values (ADR-0008). |

Conventions:

- Every command supports `--json` (covers **output and errors**).
- `--help` on every command is the agent-facing discovery surface; oclif also
  emits a machine-readable command manifest (`oclif.manifest.json`).
- Exit status is **success/failure only**; granularity lives in `error.code`.

### run resolution & precedence

1. Merge schema defaults ← environment values.
2. Resolve every `!secret` through the environment's provider — a pinned
   `{ version: N }` resolves exactly version `N`, a bare `!secret` resolves
   `latest` (ADR-0009).
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
  quotes, unicode, multi-KB, and the empty string). A backend that cannot hold an
  empty value (the `gcp` adapter — Secret Manager rejects empty payloads) instead
  rejects it with `ADAPTER_ERROR`; this is the contract's one sanctioned
  per-backend divergence.

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
