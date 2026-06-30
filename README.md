# keyshelf

A CLI for managing application **config and secrets** across environments in a
monorepo. keyshelf validates each environment against a declared schema, and
stores and fetches values through pluggable adapters (`sops`, `gcp`). There is
no web UI — the CLI is the only interface, designed to be discoverable by both
humans and coding agents.

The committed environment file is the source of truth: it declares which keys
exist, whether each is plaintext config or a `!secret`, and (for versioned
backends) exactly which secret version a deploy resolves. Secret _values_ never
live in the repo — only references into an adapter's store.

> The authoritative glossary lives in [`CONTEXT.md`](./CONTEXT.md); the full
> command + reference surface in [`docs/reference.md`](./docs/reference.md).
> This README links out rather than restating them.

## Core concepts

One line each — see [`CONTEXT.md`](./CONTEXT.md) for the authoritative
definitions.

- **Project** — the top-level name in `config.yaml`; namespaces secrets in shared backends.
- **Shelf** — a named bundle of exactly one schema and the environments that implement it (a directory under `.keyshelf/`).
- **Stage** — a deployment name shared across shelves (`dev`, `staging`, `production`).
- **Environment** — a shelf at a stage (`{shelf}/{stage}`); supplies the actual values.
- **Schema** — the declared, closed shape of a shelf's environments (which keys may exist + each key's presence requirement).
- **Adapter** — the code that talks to one backend type (`sops`, `gcp`); defines _how_ values are stored and fetched.
- **Provider** — a configured instance of an adapter, declared in `config.yaml` and referenced by name (e.g. `gcp-staging`).
- **Config (value)** — the plaintext representation of a key; committed to the repo.
- **Secret (value)** — the sensitive representation, marked `!secret`; resolved through a provider, never stored in plaintext.
- **Reference** — a pointer to where a value actually lives: a _store reference_ (`!secret` into an adapter store) or a _key reference_ (`!ref` to another key).

## Install

```sh
npm i -g keyshelf
```

One install pulls in the matching per-platform `sops` binary automatically — you
never install sops separately. See [`docs/distribution.md`](./docs/distribution.md)
for the full model.

## Quick start

A minimal end-to-end flow using the default `local` (sops) provider, which
`init` scaffolds for you — no cloud account required.

```sh
# 1. Scaffold .keyshelf/ with a `local` sops provider and an `app` shelf.
keyshelf init --project myapp --shelf app

# 2. Declare the schema (presence only — not plaintext-vs-secret).
#    Edit .keyshelf/app/schema.yaml so `keys:` reads:
#      LOG_LEVEL: info          # config default
#      DATABASE_PASSWORD: !required

# 3. Set a plaintext config value for the production environment.
echo "debug" | keyshelf set LOG_LEVEL app/production

# 4. Set a secret. The value is read from stdin and stored encrypted in the
#    sops store under the shelf's secrets/ folder — never written to the
#    environment file in plaintext.
echo "s3cr3t" | keyshelf set DATABASE_PASSWORD app/production --secret

# 5. Validate the environment against its schema (offline; resolves no secrets).
keyshelf validate app/production

# 6. Run a command with config + secrets resolved into its environment.
keyshelf run app/production -- node server.js
```

After step 4, `.keyshelf/app/production.yaml` holds a `DATABASE_PASSWORD: !secret`
reference (the encrypted value lives in `.keyshelf/app/secrets/production.yaml`),
and `keyshelf run` resolves it into `DATABASE_PASSWORD` in the child process's
environment.

## Commands

| Command       | Purpose                                                                          |
| ------------- | -------------------------------------------------------------------------------- |
| `init`        | Scaffold `.keyshelf/` (project + a `local` sops provider + a starter shelf).     |
| `set`         | Write a value: plaintext config, a `!secret` (stored + referenced), or a `!ref`. |
| `run`         | Resolve config + secrets into env vars and exec a command.                       |
| `validate`    | Run the closed-contract + resolution checks (per-environment or whole-project).  |
| `ls` (`list`) | Print an offline project map or an environment's schema contract; never values.  |

Every command supports `--json` for machine-readable output and errors, and
`--help` for discovery. See [`docs/reference.md`](./docs/reference.md) for the
full flag surface, error codes, and resolution precedence.

## Adapters

- **sops** — stores each environment's secrets in an encrypted file under the
  shelf's `secrets/` directory (`{shelf}/secrets/{stage}.yaml`), committed to the
  repo. Self-contained: the
  `sops` binary ships with keyshelf. See [ADR-0003](./docs/adr/0003-typescript-with-bundled-sops-binary.md).
- **gcp** — stores each secret in Google Cloud Secret Manager, one secret per key
  under the deterministic name `keyshelf__{project}__{shelf}__{stage}__{key}`,
  via the official SDK (auth is Application Default Credentials — keyshelf owns no
  credentials). Stores raw bytes, so the value keyshelf writes is the value any
  native consumer reads. See [ADR-0006](./docs/adr/0006-gcp-secret-manager-adapter.md).

## Deploying to Cloud Run

There are **three** distinct ways a secret reaches a Cloud Run service. They get
conflated constantly — keep them apart. The first two are valid (pick per your
needs); the third is an anti-pattern to avoid.

### 1. Native `secretKeyRef` (recommended for secrets)

Cloud Run stores only a _reference_ (secret name + version) in the revision spec
and fetches the value from Secret Manager at instance startup — the plaintext
**never lands in the revision**. keyshelf's gcp adapter writes raw bytes under
the deterministic name `keyshelf__{project}__{shelf}__{stage}__{key}`
([ADR-0006](./docs/adr/0006-gcp-secret-manager-adapter.md)) precisely so this
native path works without any decode step.

Wire a keyshelf-written secret straight into the service. For a project `myapp`,
shelf `backend`, stage `production`, key `DATABASE_PASSWORD`, the secret id is
`keyshelf__myapp__backend__production__DATABASE_PASSWORD`:

```sh
gcloud run services update backend \
  --update-secrets \
  DATABASE_PASSWORD=keyshelf__myapp__backend__production__DATABASE_PASSWORD:latest
```

Or, in a service YAML:

```yaml
spec:
  template:
    spec:
      containers:
        - image: gcr.io/myapp/backend
          env:
            - name: DATABASE_PASSWORD
              valueFrom:
                secretKeyRef:
                  key: latest # or a concrete version, e.g. "8"
                  name: keyshelf__myapp__backend__production__DATABASE_PASSWORD
```

This path consumes the secret directly from the backend; it does not run
keyshelf in the container, so schema validation and `!ref` resolution don't
apply at runtime. Use it when you want GCP to own secret delivery and the
revision spec to record exactly which secrets (and versions) the service uses.

### 2. The `keyshelf run` entrypoint wrapper

Make `keyshelf run` the container entrypoint so config + secrets resolve at
startup and the wrapped process inherits them:

```dockerfile
ENTRYPOINT ["keyshelf", "run", "backend/production", "--", "node", "server.js"]
```

Authentication is the runtime service account's Application Default Credentials —
**no credentials are shipped** in the image. The non-secret manifests
(`.keyshelf/` config, schema, environment files) are baked into the image;
secrets are fetched from Secret Manager at startup.

- **Upside.** keyshelf's full model runs identically across Cloud Run, local,
  and CI: schema validation, `!ref` key references, and env-varying config +
  secrets unified under one resolve step. The Cloud Run service spec stays
  trivial (no per-secret wiring).
- **Costs.** keyshelf + Node + the non-secret manifests are baked into the image;
  GCP has reduced visibility into which secrets the service actually uses (they
  resolve at runtime, not in the spec); and the container gains a startup
  dependency on Secret Manager. It also requires the signal-forwarding fix
  ([#241](https://github.com/pantoninho/keyshelf/issues/241)) so the wrapped
  process shuts down gracefully on `SIGTERM`.

### 3. Anti-pattern to avoid: literal `env.value`

Do **not** resolve a secret's _value_ into a plain Cloud Run env var. This bakes
the plaintext into the revision spec, where it is visible to anyone who can read
the service config and is captured in revision history:

```yaml
# DO NOT DO THIS — plaintext secret baked into the revision spec.
env:
  - name: DATABASE_PASSWORD
    value: "s3cr3t" # ← leaked into the revision; readable, versioned, exported
```

Contrast with mechanism #1, where `valueFrom.secretKeyRef` keeps only a
_reference_ in the spec and the value stays in Secret Manager.

### Floating vs pinned

keyshelf's [version pinning](./docs/adr/0009-secret-version-pinning.md)
(ADR-0009) determines whether a rotated secret reaches running instances on its
own or only after a deploy. The same env-file form drives _both_ consumption
paths above:

| Mode         | Env-file reference       | Behavior                                                                                                                                                             |
| ------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Floating** | bare `!secret`           | resolves the backend's `latest` — a new secret version reaches new instances with no deploy and no diff.                                                             |
| **Pinned**   | `!secret { version: N }` | resolves exactly version `N` — rotating the value is a committed env-file diff that gates rollout (the new value can't take effect until the manifest change ships). |

On a versioned backend (gcp), `keyshelf set --secret` **pins the version it
writes by default** (records `version: N`); `--floating` opts out and records a
bare `!secret`. To advance an existing pin to the current latest version
_without_ changing the value, use `keyshelf set --pin-latest`. The flags
`--secret`, `--floating`, and `--pin-latest` are mutually exclusive.

```sh
# Pin by default: records `DATABASE_PASSWORD: !secret { version: N }`.
echo "rotated" | keyshelf set DATABASE_PASSWORD backend/production --secret

# Opt out: records a bare floating `!secret`.
echo "rotated" | keyshelf set DATABASE_PASSWORD backend/production --secret --floating

# Re-pin an existing secret to the current latest version (no value read).
keyshelf set DATABASE_PASSWORD backend/production --pin-latest
```

Pinning is **N/A for sops** — its value lives in the committed encrypted store
file (under the shelf's `secrets/` folder) and is already deploy-gated by
construction. The mapping to Cloud Run is
direct: a pinned `!secret { version: N }` corresponds to `secretKeyRef.key: "N"`
(or the wrapper resolving version `N`); a bare floating `!secret` corresponds to
`secretKeyRef.key: latest` (or the wrapper resolving latest).

## Migrating from v5

keyshelf@6 is a ground-up redesign, not an incremental upgrade — the config
format, the key model, and the provider set all changed. See
[`docs/migrating-from-v5.md`](./docs/migrating-from-v5.md).

## Changelog

Release notes are generated from conventional commits by release-please. See
[`packages/cli/CHANGELOG.md`](./packages/cli/CHANGELOG.md) or the
[GitHub Releases](https://github.com/pantoninho/keyshelf/releases) page.
