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

# 10. Create a .env.keyshelf file to map paths to env var names
#     echo "DATABASE_HOST=database/host" >> .env.keyshelf
#     echo "DATABASE_PASSWORD=database/password" >> .env.keyshelf

# 11. Run a process with config and secrets injected as env vars
keyshelf run --env dev -- node server.js
```

---

## Integration Guide

Step-by-step instructions for integrating keyshelf into an existing project. Each step produces a specific file — no ambiguity, no "edit the file" instructions.

### What belongs in keyshelf

Database credentials, API keys, service URLs, feature flags, connection strings, port numbers, external service config — anything your app reads from environment variables or config files that varies across environments.

### Step 1: Initialize

```bash
keyshelf init
```

This creates `keyshelf.yml` and `.keyshelf/environments/`. The generated `keyshelf.yml` will contain:

```yaml
name: <directory-name>
provider:
    adapter: local
```

For cloud providers, use `keyshelf init --adapter gcp-sm --project <id>` or `keyshelf init --adapter aws-sm`.

### Step 2: Create environments

```bash
keyshelf env:create base
keyshelf env:create dev --import base
keyshelf env:create prod --import base
```

This creates three files under `.keyshelf/environments/`. Each starts with an empty `values: {}` block.

### Step 3: Define config values in YAML

Write plain config values directly into the environment YAML files. Use `!secret` tags for values that must be stored in the provider.

`.keyshelf/environments/base.yml`:

```yaml
values:
    database:
        port: 5432
        password: !secret database/password
    app:
        log-level: info
        api-key: !secret app/api-key
```

`.keyshelf/environments/dev.yml`:

```yaml
imports:
    - base
values:
    database:
        host: localhost
    app:
        debug: true
```

`.keyshelf/environments/prod.yml`:

```yaml
imports:
    - base
values:
    database:
        host: prod-db.internal
    app:
        debug: false
```

`dev` and `prod` inherit `database/port`, `database/password`, `app/log-level`, and `app/api-key` from `base`. They override only the values that differ.

### Step 4: Create the `.env.keyshelf` mapping

The `.env.keyshelf` file maps keyshelf paths to the environment variable names your application reads.

```bash
# .env.keyshelf
DATABASE_HOST=database/host
DATABASE_PORT=database/port
DATABASE_PASSWORD=database/password
APP_DEBUG=app/debug
APP_LOG_LEVEL=app/log-level
APP_API_KEY=app/api-key
```

Only paths listed here are injected as environment variables by `keyshelf run` and `keyshelf/preload`.

### Step 5: Provision secrets

```bash
# Interactive — prompts for each missing secret value
keyshelf up --apply

# Or from a file
keyshelf up --apply --from-file .env.secrets
```

### Step 6: Run your application

```bash
keyshelf run --env dev -- node server.js
```

Or use the Node.js preload (no wrapper command needed):

```bash
KEYSHELF_ENV=dev node --import keyshelf/preload dist/server.js
```

### Complete file listing

After integration, the project should contain:

```
myproject/
├── keyshelf.yml
├── .env.keyshelf
└── .keyshelf/
    └── environments/
        ├── base.yml
        ├── dev.yml
        └── prod.yml
```

`keyshelf.yml`:

```yaml
name: myproject
provider:
    adapter: local
```

`.env.keyshelf`:

```bash
DATABASE_HOST=database/host
DATABASE_PORT=database/port
DATABASE_PASSWORD=database/password
APP_DEBUG=app/debug
APP_LOG_LEVEL=app/log-level
APP_API_KEY=app/api-key
```

`.keyshelf/environments/base.yml`:

```yaml
values:
    database:
        port: 5432
        password: !secret database/password
    app:
        log-level: info
        api-key: !secret app/api-key
```

`.keyshelf/environments/dev.yml`:

```yaml
imports:
    - base
values:
    database:
        host: localhost
    app:
        debug: true
```

`.keyshelf/environments/prod.yml`:

```yaml
imports:
    - base
values:
    database:
        host: prod-db.internal
    app:
        debug: false
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

### The `.env.keyshelf` Mapping

The `.env.keyshelf` file lives in the project root and defines how keyshelf paths map to environment variable names. This mapping belongs to the consumer (your app), not to the environment definition.

```bash
# .env.keyshelf
DATABASE_HOST=database/host
DATABASE_PASSWORD=database/password
REDIS_URL=cache/redis/url
```

When `keyshelf run`, `keyshelf print --format env`, or the preload module is used, only the variables listed in `.env.keyshelf` are exported. If the file is absent, no environment variables are injected (a warning is shown).

**Format rules:**

- One `ENV_VAR_NAME=keyshelf/path` mapping per line.
- Left side (env var name): uppercase letters, digits, and underscores. Must match `[A-Z_][A-Z0-9_]*`.
- Right side (keyshelf path): slash-delimited path matching a leaf in the environment YAML. Alphanumeric, hyphens, and slashes: `[a-z0-9-]+(/[a-z0-9-]+)*`.
- Lines starting with `#` are comments. Blank lines are ignored.
- No quoting, no spaces around `=`, no variable interpolation.

---

## File Structure

```
myproject/
├── keyshelf.yml                          # Project-level config
├── .env.keyshelf                         # Env var name → path mapping (consumer-side)
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

# Print as shell-sourceable KEY=VALUE pairs (uses .env.keyshelf mapping)
keyshelf print --env dev --format env --reveal

# Print as JSON with secrets split into a separate object (no --reveal)
keyshelf print --env dev --format json
```

When `--format json` is used without `--reveal`, the output is an object with two keys:

- `config` — plain values, keyed by slash-delimited path
- `secrets` — provider reference strings, keyed by slash-delimited path

---

### `keyshelf run`

Run a command with the resolved environment injected as process environment variables. Requires a `.env.keyshelf` file in the project root to define which paths map to which env var names. Resolves secrets from the provider and merges with the current `process.env`.

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
  --from-file=<value>  Read new secret values from a KEY=VALUE file
```

```bash
# Show plan and prompt for confirmation, then prompt for each new secret value
keyshelf up

# Skip confirmation prompt, then prompt for each new secret value
keyshelf up --apply

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

# Create environments
keyshelf env:create base
keyshelf env:create dev --import base
keyshelf env:create prod --import base

# Import plain values from your .env into the base environment
keyshelf import --env base .env

# Import secrets (stores values in provider, writes !secret refs to YAML)
keyshelf import --env base .env --secrets

# Create .env.keyshelf so the same env var names your app already reads keep working.
# For each KEY=VALUE in your .env, write a line: KEY=keyshelf/path
# The keyshelf path is the lowercased key with underscores replaced by slashes,
# or whatever path structure you chose during import.
# Example: if your .env had DATABASE_HOST=localhost, write:
#   DATABASE_HOST=database-host
# (keyshelf import converts underscores in keys to hyphens by default)

# Verify the result
keyshelf list --env dev
keyshelf print --env dev --reveal
```

### Integrating a project that reads `process.env` directly

If your application reads environment variables directly (e.g., `process.env.DATABASE_URL`), you do not need to change application code. keyshelf injects variables at runtime.

1. Identify every `process.env.X` or `os.environ["X"]` your app reads.
2. Decide which are application config (put in keyshelf) vs runtime context (leave out). See [What belongs in keyshelf](#what-belongs-in-keyshelf).
3. Create the YAML structure under `.keyshelf/environments/` with appropriate `!secret` tags for sensitive values.
4. Create `.env.keyshelf` mapping each env var name to its keyshelf path.
5. Run `keyshelf up --apply` to provision secrets.
6. Replace your existing start command with `keyshelf run --env <name> -- <command>` or use the `keyshelf/preload` entry point.

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

# Apply using a secrets export file
keyshelf up --apply --from-file secrets.env
```

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
