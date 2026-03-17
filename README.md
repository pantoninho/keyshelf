# keyshelf

CLI tool for managing hierarchical config values and secrets across environments.

Config values live in version-controlled YAML. Secrets live in external providers (local filesystem, GCP Secret Manager, AWS Secrets Manager). YAML files reference secrets via `!secret` tags — safe to commit, nothing sensitive ever touches the file.

---

## Install

Requires Node >= 20.

```bash
npm install -g keyshelf
```

Or run without installing:

```bash
npx keyshelf init
```

---

## Quick Start

```bash
# 1. Initialize the project (creates keyshelf.yml and .keyshelf/environments/)
keyshelf init

# 2. Create environments
keyshelf env:create base
keyshelf env:create dev --import base
keyshelf env:create prod --import base

# 3. Edit .keyshelf/environments/base.yml to add plain config values
#    (see File Structure below for examples)

# 4. Set a secret value — keyshelf stores it in the provider and writes
#    a !secret reference into the YAML file
keyshelf set --env dev database/password

# 5. Inspect what an environment resolves to
keyshelf list --env dev
keyshelf get --env dev database/host

# 6. Print the full resolved config (secrets shown as provider refs by default)
keyshelf print --env dev

# 7. Print with secrets revealed
keyshelf print --env dev --reveal

# 8. Reconcile all environments against the provider (show a plan)
keyshelf up

# 9. Apply the reconciliation plan interactively
keyshelf up --apply

# 10. Run a process with config and secrets injected as env vars
keyshelf run --env dev -- node server.js
```

---

## Core Concepts

### Config vs Secrets

Plain values are stored directly in YAML and are safe to commit:

```yaml
values:
    database:
        host: localhost
        port: 5432
```

Secrets are stored in an external provider. The YAML file holds only a `!secret` reference to the path — the value itself never appears in the file:

```yaml
values:
    database:
        host: localhost
        port: 5432
        password: !secret database/password
```

When keyshelf resolves an environment it fetches each `!secret` from the configured provider and substitutes the actual value.

### Environment Inheritance

Environments can import other environments. Imports are merged using RFC 7396 patch semantics: later imports win over earlier ones, and the current environment's own values win over everything it imports.

```yaml
# .keyshelf/environments/prod.yml
# database/port and database/password are inherited from base
imports:
    - base
    - shared
values:
    database:
        host: prod-db.internal
```

Resolution order for `prod` importing `[base, shared]`:

1. Resolve `base` recursively (applying its own imports first).
2. Resolve `shared` recursively.
3. Merge `base`, then merge `shared` on top (shared wins over base).
4. Merge `prod`'s own values on top (prod wins over everything).

Circular imports are detected at resolution time and produce an error.

### Providers

A provider is the backend that stores secret values. The provider is declared in `keyshelf.yml` and can be overridden per environment.

| Adapter  | Where secrets are stored                    | Auth                            |
| -------- | ------------------------------------------- | ------------------------------- |
| `local`  | `~/.config/keyshelf/<project>/secrets.json` | None                            |
| `gcp-sm` | GCP Secret Manager                          | Application Default Credentials |
| `aws-sm` | AWS Secrets Manager                         | Standard AWS credential chain   |

### The `env` Mapping

The `env` field in an environment file defines how paths map to environment variable names. It is bidirectional: when running `keyshelf run` or using the preload module, keyshelf uses this mapping to produce the exact variable names your application expects.

```yaml
env:
    DATABASE_HOST: database/host
    DATABASE_PASSWORD: database/password
    REDIS_URL: cache/redis/url
values:
    database:
        host: localhost
        password: !secret database/password
    cache:
        redis:
            url: redis://localhost:6379
```

When `env` is defined, **only** the mapped variables are exported. When `env` is absent, all leaf values are exported using auto-generated `UPPER_SNAKE_CASE` names derived from the path (`database/host` becomes `DATABASE_HOST`).

The `env` mapping is also used by `keyshelf up --from-env`: keyshelf collects mappings across all environments and looks up each secret path by its mapped variable name.

---

## File Structure

```
myproject/
├── keyshelf.yml                          # Project-level config
└── .keyshelf/
    └── environments/
        ├── base.yml                      # Shared base config
        ├── dev.yml                       # Development environment
        └── prod.yml                      # Production environment
```

### keyshelf.yml

```yaml
# Project name — used in provider secret naming
# provider.adapter options: local | gcp-sm | aws-sm
name: myproject
provider:
    adapter: local
```

For GCP Secret Manager:

```yaml
name: myproject
provider:
    adapter: gcp-sm
    project: my-gcp-project-id
```

For AWS Secrets Manager:

```yaml
name: myproject
provider:
    adapter: aws-sm
```

### .keyshelf/environments/\<name\>.yml

```yaml
# Optional: inherit from other environments
imports:
    - base
    - shared

# Optional: override the provider for this environment only
provider:
    adapter: gcp-sm
    project: my-prod-project

# Optional: explicit env var name to path mapping
env:
    DATABASE_HOST: database/host
    DATABASE_PASSWORD: database/password
    APP_SECRET_KEY: app/secret-key

# Required: values for this environment
values:
    database:
        host: prod-db.internal
        port: 5432
        password: !secret database/password
    app:
        debug: false
        secret-key: !secret app/secret-key
```

All keys under `values` are slash-path addressable: `database/password`, `app/secret-key`.

---

## Command Reference

### `keyshelf init`

Initialize a new keyshelf project in the current directory. Creates `keyshelf.yml` and the `.keyshelf/environments/` directory.

```
USAGE
  keyshelf init [FLAGS]

FLAGS
  -f, --force             Overwrite existing keyshelf.yml
      --adapter=<option>  Secret provider adapter  [default: local]
                          <options: local|gcp-sm|aws-sm>
      --project=<value>   GCP project ID (required when --adapter=gcp-sm)
```

```bash
keyshelf init
keyshelf init --adapter gcp-sm --project my-gcp-project
keyshelf init --adapter aws-sm
keyshelf init --force
```

---

### `keyshelf env:create`

Create a new environment file under `.keyshelf/environments/`.

```
USAGE
  keyshelf env:create <name> [FLAGS]

ARGUMENTS
  name  Environment name (required)

FLAGS
  -i, --import=<value>...  Import another environment (repeatable)
      --adapter=<option>   Secret provider adapter for this environment
                           <options: local|gcp-sm|aws-sm>
      --project=<value>    GCP project ID (required when --adapter=gcp-sm)
```

```bash
keyshelf env:create base
keyshelf env:create dev --import base
keyshelf env:create staging --import base --import shared
keyshelf env:create prod --import base --adapter gcp-sm --project myapp-prod
```

Fails if the environment already exists.

---

### `keyshelf get`

Get a single resolved value from an environment. For secrets, the actual value is fetched from the provider. For plain values, the value is printed directly.

```
USAGE
  keyshelf get <path> --env <name>

ARGUMENTS
  path  Slash-delimited path to the value (required)

FLAGS
  --env=<value>  Environment name (required)
```

```bash
keyshelf get --env dev database/host
keyshelf get --env prod database/password
```

Exits with an error if the path does not exist or resolves to a subtree rather than a leaf.

---

### `keyshelf list`

List all leaf paths in a resolved environment. Paths that hold secrets are annotated with `(secret)`.

```
USAGE
  keyshelf list --env <name>

FLAGS
  --env=<value>  Environment name (required)
```

```bash
keyshelf list --env dev
```

Example output:

```
database/host
database/port
database/password (secret)
app/debug
app/secret-key (secret)
```

---

### `keyshelf set`

Set a secret value in an environment. If the path does not already hold a `!secret` reference in the YAML, keyshelf writes one automatically (with a warning if it overwrites a plain value). After writing to the provider, the value is propagated to all environments that transitively import this one.

```
USAGE
  keyshelf set <path> [value] --env <name>

ARGUMENTS
  path   Slash-delimited secret path (required)
  value  Secret value — prompted (masked input) if omitted

FLAGS
  --env=<value>  Environment name (required)
```

```bash
keyshelf set --env dev database/password
keyshelf set --env dev database/password mysecret
```

---

### `keyshelf print`

Print the fully resolved config for an environment. Secrets are shown as their provider reference string by default. Use `--reveal` to fetch and display actual values.

```
USAGE
  keyshelf print --env <name> [FLAGS]

FLAGS
  --env=<value>      Environment name (required)
  --reveal           Show actual secret values  [default: false]
  --format=<option>  Output format  [default: yaml]
                     <options: yaml|json|env>
```

```bash
# Print as YAML with secret refs (no provider calls)
keyshelf print --env dev

# Print with secrets revealed
keyshelf print --env dev --reveal

# Print as shell-sourceable KEY=VALUE pairs (requires --reveal for secret values)
keyshelf print --env dev --format env --reveal

# Print as JSON with secrets split into a separate object (no --reveal)
keyshelf print --env dev --format json
```

When `--format json` is used without `--reveal`, the output is an object with two keys:

- `config` — plain values, keyed by slash-delimited path
- `secrets` — provider reference strings, keyed by slash-delimited path

---

### `keyshelf run`

Run a command with the resolved environment injected as process environment variables. Resolves secrets from the provider and merges with the current `process.env`.

```
USAGE
  keyshelf run --env <name> -- <command> [args...]

FLAGS
  --env=<value>  Environment name (required)
```

```bash
keyshelf run --env dev -- node server.js
keyshelf run --env prod -- docker compose up
keyshelf run --env staging -- npm start
```

The command must be separated from keyshelf flags with `--`.

---

### `keyshelf import`

Import `KEY=VALUE` pairs from a file into an environment. Each key becomes a slash-delimited path, optionally nested under `--prefix`.

```
USAGE
  keyshelf import <file> --env <name> [FLAGS]

ARGUMENTS
  file  Path to a KEY=VALUE file (required)

FLAGS
  --env=<value>     Environment name (required)
  --prefix=<value>  Nest all values under this path
  --secrets         Treat all values as secrets  [default: false]
```

```bash
# Import plain config values
keyshelf import --env dev .env

# Import plain values nested under a path prefix
keyshelf import --env dev .env.database --prefix database

# Import as secrets (stores values in provider, writes !secret refs to YAML)
keyshelf import --env dev .env.secrets --secrets
```

The file format is standard `KEY=VALUE`, one entry per line. Lines starting with `#` are treated as comments.

---

### `keyshelf up`

Reconcile all environments: compare secrets declared in YAML against what is actually stored in the provider, display a plan, and optionally apply it.

```
USAGE
  keyshelf up [FLAGS]

FLAGS
  --apply              Skip the y/N confirmation prompt  [default: false]
  --from-env           Read new secret values from process environment variables  [default: false]
  --from-file=<value>  Read new secret values from a KEY=VALUE file
```

```bash
# Show plan and prompt for confirmation, then prompt for each new secret value
keyshelf up

# Skip confirmation prompt, then prompt for each new secret value
keyshelf up --apply

# Skip confirmation, reading new values from the current process environment
keyshelf up --apply --from-env

# Skip confirmation, reading new values from a file
keyshelf up --apply --from-file .env.secrets
```

The plan shows three change types:

- `+` (green) — secret is declared in YAML but missing from the provider; value will be prompted or read from source
- `-` (red) — secret is present in the provider but no longer declared in YAML; will be deleted
- `↻` (cyan) — secret can be copied from an imported environment that already has it; no value input required

Environments are processed in topological order (imports before the environments that depend on them).

---

## Recipes

### Migrating from .env files

```bash
# Initialize the project
keyshelf init

# Create an environment
keyshelf env:create dev

# Import plain values from your .env
keyshelf import --env dev .env

# Import secrets from a separate secrets file (stores in provider)
keyshelf import --env dev .env.secrets --secrets

# Verify the result
keyshelf list --env dev
keyshelf print --env dev --reveal
```

### Adding a derived environment

```bash
# Create a staging environment that inherits everything from dev
keyshelf env:create staging --import dev

# Edit .keyshelf/environments/staging.yml to override specific values:
#   values:
#     database:
#       host: staging-db.internal

# Set staging-specific secrets
keyshelf set --env staging database/password

# Verify staging resolves correctly
keyshelf print --env staging --reveal
```

### Reconciling with `up`

After editing environment YAML files — adding new `!secret` refs or removing old ones — use `up` to sync provider state:

```bash
# Preview changes across all environments
keyshelf up

# Apply with interactive prompts for each new secret value
keyshelf up --apply

# Apply using values already present in CI environment variables
keyshelf up --apply --from-env

# Apply using a secrets export file
keyshelf up --apply --from-file secrets.env
```

`--from-env` works by collecting the `env` mappings from all environment files and looking up each secret path by its corresponding variable name. Ensure the variables are set in the calling shell before running this.

### Running processes with secrets

```bash
# All resolved config and secrets are injected into the subprocess
keyshelf run --env prod -- node dist/server.js

# Works with any executable
keyshelf run --env dev -- python manage.py runserver
keyshelf run --env staging -- ./scripts/migrate.sh
```

The subprocess receives the current `process.env` merged with the resolved keyshelf values. Keyshelf values take precedence.

### Programmatic usage via preload

Use the `keyshelf/preload` entry point to inject environment variables before your application code runs, without any code changes in the application:

```bash
KEYSHELF_ENV=dev node --import keyshelf/preload dist/server.js
```

Or in `package.json`:

```json
{
    "scripts": {
        "start": "KEYSHELF_ENV=prod node --import keyshelf/preload dist/server.js",
        "dev": "KEYSHELF_ENV=dev node --import keyshelf/preload dist/server.js"
    }
}
```

### Secret propagation behavior on `set`

When you run `keyshelf set --env base database/password`, keyshelf automatically propagates the value to every environment that transitively imports `base` and has a `!secret` reference at `database/password`. This keeps provider state in sync without setting the same secret multiple times.

```bash
# If dev and staging both import base, this sets database/password in all three
keyshelf set --env base database/password
```

Each environment uses its own provider. If `base` uses `local` and `prod` uses `gcp-sm`, keyshelf writes to both backends in the same operation.

---

## Providers

### local

Stores secrets in a JSON file at `~/.config/keyshelf/<project-name>/secrets.json`. Suitable for local development. No authentication or external dependencies required.

Secret structure inside the file: `{ "<env>": { "<path>": "<value>" } }`.

The file is never written inside the project directory and should not be committed.

### gcp-sm

Stores secrets in [GCP Secret Manager](https://cloud.google.com/secret-manager). Uses Application Default Credentials — run `gcloud auth application-default login` or set `GOOGLE_APPLICATION_CREDENTIALS`.

Secret naming convention:

```
<project-name>__<env>__<path-with-slashes-replaced-by-double-underscores>
```

Example: project `myapp`, env `prod`, path `database/password` → `myapp__prod__database__password`

GCP secret IDs have a 255-character limit. keyshelf enforces this limit and errors before attempting to write.

The `project` field must be the GCP **project ID** (not the display name).

### aws-sm

Stores secrets in [AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/). Uses the standard AWS credential chain (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_PROFILE` / IAM role, etc.).

Secret naming convention:

```
keyshelf/<project-name>/<env>/<path>
```

Example: project `myapp`, env `prod`, path `database/password` → `keyshelf/myapp/prod/database/password`

The project name must not contain `/`. Deletion bypasses the recovery window (`ForceDeleteWithoutRecovery: true`).

### Per-environment provider override

Any environment can declare its own `provider` block to override the project default:

```yaml
# .keyshelf/environments/dev.yml
imports:
  - base
provider:
  adapter: local
values:
  database:
    host: localhost

# .keyshelf/environments/prod.yml
imports:
  - base
provider:
  adapter: gcp-sm
  project: myapp-prod
values:
  database:
    host: prod-db.internal
```

---

## Environment Resolution

### Import resolution order

For an environment `staging` with `imports: [base, shared]`:

1. Resolve `base` recursively (applying `base`'s own imports first).
2. Resolve `shared` recursively.
3. Merge `base`, then merge `shared` on top (shared wins over base for any conflicting keys).
4. Merge `staging`'s own `values` on top (staging wins over everything).

### Merge semantics

Merge is a deep, key-level overwrite following [RFC 7396](https://www.rfc-editor.org/rfc/rfc7396). A key in a later operand replaces the same key in an earlier operand at every level of nesting.

Given:

```yaml
# base
values:
    database:
        host: localhost
        port: 5432
        password: !secret database/password
```

```yaml
# prod (imports base)
# port and password are inherited from base unchanged
values:
    database:
        host: prod-db.internal
```

The resolved `prod` tree is:

```yaml
database:
    host: prod-db.internal
    port: 5432
    password: !secret database/password
```

### Cycle detection

If environment A imports B and B imports A (directly or transitively), keyshelf throws at resolution time:

```
Circular import detected: "A" was already visited. Check your import chain for cycles.
```

---

## Programmatic API

### keyshelf/preload

The `keyshelf/preload` entry point resolves an environment and sets all values as `process.env` variables before application code runs. Use it with Node's `--import` flag.

```bash
KEYSHELF_ENV=prod node --import keyshelf/preload dist/server.js
```

Environment variables read by the preload module:

| Variable               | Required | Description                                                                                      |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `KEYSHELF_ENV`         | Yes      | Environment name to resolve                                                                      |
| `KEYSHELF_PROJECT_DIR` | No       | Path to the project root containing `keyshelf.yml`. Defaults to `process.cwd()`                  |
| `KEYSHELF_CONFIG_DIR`  | No       | Override path for the provider config directory. Defaults to `~/.config/keyshelf/<project-name>` |

---

## License

ISC
