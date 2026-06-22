---
name: keyshelf
description: Use when working in a repository that contains a `.keyshelf/` directory (a `.keyshelf/config.yaml`, a shelf's `schema.yaml`, or a `{shelf}/{stage}.yaml` environment file), or when the user mentions keyshelf, `keyshelf init/set/run/validate`, a keyshelf project/shelf/schema/provider/adapter, or asks to add, set, inject, or validate a config value or secret in such a repo. Keyshelf is a CLI that manages config and secrets through YAML files plus pluggable adapters; the rules below are easy to misapply from intuition alone.
---

# Keyshelf

Keyshelf manages config and secrets through a `.keyshelf/` directory of YAML files. A project-global `config.yaml` declares the project name and its providers; each **shelf** (a subdirectory) holds one `schema.yaml` (the closed contract of which keys may exist) and one YAML file per **environment** that implements it. The CLI merges schema defaults with environment values, resolves every `!secret` through its provider's adapter, and exposes the result as environment variables to a wrapped command.

**Before doing anything in a keyshelf repo, read `.keyshelf/config.yaml`, the relevant shelf's `schema.yaml`, and the `{stage}.yaml` you intend to touch.** Almost every mistake below comes from skipping that step and guessing — especially guessing whether a key is config or secret, or assuming a key exists that the schema does not declare.

## Mental model

The vocabulary is load-bearing; use it precisely.

- **Project** — the required top-level `project:` name in `config.yaml`. It namespaces secrets inside shared backends (it is composed into a remote secret's name). One project per `.keyshelf/`.
- **Provider** — a configured instance of an adapter, declared under `providers:` in `config.yaml` and referenced by name (e.g. `gcp-staging`). A provider is an adapter plus its config. Providers are **project-global**: any environment in any shelf may reference any provider.
- **Adapter** — the implementation that talks to one kind of backend: `sops`, `gcp`, or the in-memory `fake` (test-only). It defines _how_ secret values are stored and fetched.
- **Shelf** — a named bundle of exactly one `schema.yaml` plus the environments that implement it, living in its own directory under `.keyshelf/`. A shelf's name **is its directory name**. Multiple schemas means multiple shelves.
- **Schema** — the declared shape of a shelf's environments, in `{shelf}/schema.yaml`. It governs **presence only** (which keys may exist, and whether each is defaulted / `!required` / `!optional`). It is a **closed contract**: an environment may only use keys the schema declares. It does **not** decide plaintext vs. secret. Exactly one per shelf.
- **Environment** — an implementation of its shelf's schema, in `{shelf}/{stage}.yaml`. It names a `provider:` and supplies the actual `keys:`. It is _implicitly_ bound to its shelf's schema — there is no `schema:` field. Addressed everywhere as `{shelf}/{stage}` (e.g. `web-service/staging`).
- **Key** — a single named entry, declared in the schema and given a value in an environment. A key's _representation_ (plaintext config vs. `!secret`) is chosen **per environment**, not by the schema. The same key may be plaintext in one environment and a secret in another.

Identity is **filesystem-derived**. The shelf is its directory name, the environment is its filename, the schema is the shelf's `schema.yaml`. There are no `name:` or `schema:` fields anywhere.

## File layout

```
.keyshelf/
├── config.yaml                    # project + providers (required)
└── {shelf}/                       # one shelf per schema (directory name == shelf name)
    ├── schema.yaml                # the shelf's closed validation contract
    ├── {stage}.yaml                 # an environment implementing that schema
    └── {stage}.secrets.yaml         # sops store for that environment (encrypted; committed)
```

### `config.yaml`

```text
project: myapp                   # required; namespaces secrets in shared backends
providers:
  local:
    adapter: sops                # only required field for sops
  gcp-staging:
    adapter: gcp
    projectId: my-gcp-proj-stg   # required for gcp (NOT "project" — that is the keyshelf project)
    # location: global           # optional; absent/global => automatic replication
```

### `{shelf}/schema.yaml`

```text
keys:
  LOG_LEVEL: info                # config default — overridable by an environment
  REGION: !required              # must be supplied by every environment
  FEATURE_X: !optional           # may be supplied; absence is OK
  DATABASE_PASSWORD: !required   # presence only — secret-ness is the environment's call
```

Presence only: a default value, `!required`, or `!optional`. The schema never decides plaintext vs. secret, and environments may only use keys it declares.

### `{shelf}/{stage}.yaml`

```text
provider: gcp-staging           # references a provider declared in config.yaml
keys:
  LOG_LEVEL: debug              # plaintext config — overrides the schema default
  REGION: eu-west-1             # !required key, supplied as plaintext
  DATABASE_PASSWORD: !secret    # convention: value lives in the store under this key
  DATABASE_URL: !secret { ref: shared-db-url }   # explicit reference to a foreign/pre-existing secret
```

- No `schema:` field — the environment is implicitly bound to its shelf's schema.
- Each value's representation (plaintext vs. `!secret`) is chosen **here**, per environment.
- Values are **strings** only.
- Secret _values_ never appear in this file — only `!secret` references. The actual values live in the adapter's store (sops: `{shelf}/{stage}.secrets.yaml`; gcp: the backend).
- Key names must be valid env-var identifiers: `^[A-Z_][A-Z0-9_]*$`.

## Commands (when to use what)

| Goal                                                 | Command                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| Scaffold a new project                               | `keyshelf init [--project <name>] [--shelf <name>]`          |
| Write a plaintext config value into an environment   | `keyshelf set <KEY> <shelf>/<stage>`                         |
| Write a secret value into an environment             | `keyshelf set <KEY> <shelf>/<stage> --secret`                |
| Run a command with the environment's values injected | `keyshelf run <shelf>/<stage> [--set KEY=VALUE]... -- <cmd>` |
| Validate one environment (or the whole project)      | `keyshelf validate [<shelf>/<stage>]`                        |

Every command supports `--json` (output _and_ errors). `--help` on each command is the agent-facing discovery surface. Exit status is success/failure only; granularity lives in `error.code`.

- **`init`** is non-interactive. The project defaults to the cwd name; it creates `config.yaml` with a default `local` sops provider and a starter shelf (`--shelf`, default `app`) holding an empty `schema.yaml`. It refuses to clobber an existing project without `--force`.
- **`set`** reads the value from **stdin or an interactive prompt — never from argv** (so a secret never lands in your shell history or `ps` output). Pipe it: `printf '%s' "$PW" | keyshelf set DATABASE_PASSWORD web/staging --secret`. Empty stdin is a `NO_INPUT` error. The key **must already be declared in the shelf's schema**; `set` never mutates the schema.
- **`run`** resolves config + secrets, overlays them on the inherited environment, and execs everything after `--` verbatim. It is **fail-fast**: it loads, validates, and resolves _before_ exec, so it never launches a half-populated environment. The wrapped command's exit code becomes keyshelf's exit status.
- **`validate`** runs the same closed-contract and resolution checks as `run` but executes nothing. With no argument it validates the **whole project** and exits non-zero if any environment fails; with `<shelf>/<stage>` it validates that one. "Valid means would run" — every `!secret` is actually resolved through its provider to confirm it exists.

## How resolution works

`run` (and the resolution half of `validate`) produces a flat `string → string` map:

1. Start with the schema's config **defaults**.
2. Overlay the environment's `keys:`. A plaintext value wins directly; a `!secret` is resolved through the environment's provider's adapter — by **convention on the key name**, or via an explicit `{ ref: ... }`.
3. `!required` / `!optional` keys with no default and no environment value contribute nothing.

Precedence in the child process, **highest to lowest**:

1. explicit `--set KEY=VALUE` on the `run` command line,
2. keyshelf's resolved value,
3. the inherited ambient env — **but only for keys keyshelf does not manage**. A stale ambient var for a managed key is _overridden_ by keyshelf's resolved value (the opposite of many env-injection tools).

## The footguns agents hit

### 1. Confusing config and secret

Whether a key is plaintext or secret is decided **in the environment file, per environment**, not in the schema. The schema only says a key may exist. Consequences:

- `keyshelf set <KEY> <shelf>/<stage>` writes **plaintext** into the environment file. `keyshelf set <KEY> <shelf>/<stage> --secret` hands the value to the provider's adapter and records only a `!secret` reference. Pick the flag deliberately — a credential written without `--secret` lands in the committed plaintext environment file.
- A non-sensitive value (`LOG_LEVEL`, `REGION`) should be plaintext config, not a secret. Reserve `--secret` for actual secrets.
- The same key can legitimately be `!secret` in `production` and plaintext in `dev`. Don't "fix" that to match.

### 2. The schema is a closed contract

An environment may only use keys the schema declares. Adding a key to an environment (or `set`-ting one) that the schema doesn't declare is an `UNKNOWN_KEY` error. **To add a key, edit the shelf's `schema.yaml` first**, then `set` it in each environment that needs it. `set` never declares keys — it only fills in values for keys the schema already names.

Conversely, a `!required` key with no value in some environment is a `MISSING_REQUIRED` failure at `validate`/`run` time.

### 3. Project/shelf/stage namespacing of remote secrets

Reference adapters (e.g. `gcp`) name remote secrets by the **fixed** convention:

```text
keyshelf__{project}__{shelf}__{stage}__{key}
```

(verified in `concierge/src/commands/set.ts` and `concierge/src/adapters/gcp.ts`). So `web/staging`'s `DATABASE_PASSWORD` in project `myapp` is stored as `keyshelf__myapp__web__staging__DATABASE_PASSWORD`. There is no configurable template — the only override is a per-key explicit reference (`!secret { ref: ... }`, e.g. to point at a foreign or pre-existing secret). Implications:

- The same key in two environments stays distinct in a shared backend (the `keyshelf__{project}__{shelf}__{stage}` prefix is the namespace).
- Renaming the project, shelf, environment, or key changes the remote secret's name — the old value is **not** automatically migrated.
- For sops, the store is the per-environment sibling file `{shelf}/{stage}.secrets.yaml`; convention resolution there is simply by key name within that file.

### 4. `set` won't touch the schema, and reads only from stdin

`set` never edits `schema.yaml` and never reads the value from the command line. If you find yourself wanting to pass `--value`, you're on the old (v5) model — pipe the value on stdin instead. To change the _schema_ (add/rename/remove a key, change a default or presence), **edit `schema.yaml` directly**.

### 5. `run` overrides ambient vars for managed keys

If a managed key already exists in your shell environment, keyshelf's resolved value wins; the ambient value survives only for keys keyshelf doesn't manage. Use `--set KEY=VALUE` (highest precedence) for a deliberate one-off override, not an exported shell var.

## Adapters

- **`sops`** — local, file-based encrypted secrets. The store is a committed, encrypted sibling file `{shelf}/{stage}.secrets.yaml`. Keyshelf owns no crypto of its own: it shells out to a `sops` binary (bundled per-platform, with any `sops` on `PATH` as a fallback). Recipients are governed entirely by the project's native `.sops.yaml`, which keyshelf never writes or mutates. Hermetic — works in CI with no external service.
- **`gcp`** — Google Cloud Secret Manager. One secret per key, named by the `keyshelf__{project}__{shelf}__{stage}__{key}` convention in the provider's `projectId`. Authentication is Application Default Credentials (the SDK discovers them; keyshelf holds no credentials). `location` selects replication: absent/`global` ⇒ automatic; any other value ⇒ user-managed, pinned to that region.
- **`fake`** — an in-memory adapter for tests only. Don't reach for it in a real project.

A missing backend prerequisite (e.g. the `sops` binary) surfaces as `ADAPTER_UNAVAILABLE`; a credential/decryption failure as `PROVIDER_AUTH`; a referenced secret absent from the store as `SECRET_NOT_FOUND`.

## Recipes

### Add a new secret to `production`

1. Declare the key in the shelf's schema:
   ```text
   # .keyshelf/web/schema.yaml
   keys:
     STRIPE_WEBHOOK_SECRET: !required
   ```
2. Populate it (reads stdin):
   ```sh
   printf '%s' "$SECRET" | keyshelf set STRIPE_WEBHOOK_SECRET web/production --secret
   ```
   This stores the value via the environment's provider and records a `!secret` reference in `.keyshelf/web/production.yaml`.

### Change a config default

Edit `schema.yaml` (to change the default for all environments) or the specific `{stage}.yaml` (to override it for one). `set` writes per-environment values; it does not touch the schema.

### Set a plaintext value for one environment

```sh
printf '%s' eu-west-1 | keyshelf set REGION web/staging
```

### Run an app

```sh
keyshelf run web/staging -- node server.js
keyshelf run web/staging --set LOG_LEVEL=trace -- node server.js   # one-off override
```

### Check before shipping

```sh
keyshelf validate              # whole project; non-zero exit if any environment fails
keyshelf validate web/staging  # a single environment
```

## When in doubt

- Read `.keyshelf/config.yaml`, the shelf's `schema.yaml`, and the `{stage}.yaml` first.
- Run `keyshelf validate <shelf>/<stage>` to see what keyshelf thinks is wrong before guessing.
- `--json` on any command gives structured output and a stable `error.code`; `--help` documents each command's exact surface.
