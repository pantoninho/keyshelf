# keyshelf

Configuration-driven tool for managing hierarchical config values and secrets across multiple environments.

- Config values live in version-controlled YAML files
- Secret values live in pluggable providers (local filesystem, GCP Secret Manager, AWS Secrets Manager)
- YAML files reference secrets via `!secret` tags (safe to commit)
- Environments compose via imports with JSON Merge Patch semantics
- `keyshelf up` reconciles provider state to match your YAML declarations

## Install

```bash
npm install -g keyshelf
```

Requires Node.js >= 20.

## Quick Start

```bash
# Initialize a new project
keyshelf init

# Create environments
keyshelf env:create base
keyshelf env:create dev --import base
keyshelf env:create prod --import base
```

Edit `.keyshelf/environments/base.yml`:

```yaml
values:
    database:
        port: 5432
```

Edit `.keyshelf/environments/dev.yml`:

```yaml
imports:
    - base
values:
    database:
        host: localhost
        password: !secret database/password
env:
    DB_HOST: database/host
    DB_PORT: database/port
    DB_PASS: database/password
```

Then reconcile — `keyshelf up` detects the new `!secret` reference, shows a plan, and prompts for the value:

```bash
keyshelf up
```

```
Environment: dev
  + secret  database/password  (new)

Environment: prod
  (no changes)

Apply changes? (y/N) y
Enter value for dev > database/password: ****

✓ Applied 1 change across 2 environments.
```

## How It Works

keyshelf stores configuration in `.keyshelf/environments/<name>.yml` files inside your project:

```yaml
imports:
    - base
values:
    database:
        host: localhost
        password: !secret database/password
env:
    DB_HOST: database/host
    DB_PASS: database/password
```

- **Plain values** are stored directly in YAML (safe to commit)
- **Secret values** are stored in a provider and referenced via `!secret <path>`
- **Imports** let environments inherit and override values from other environments
- **Env mapping** explicitly maps config/secret paths to env var names

The YAML files are the source of truth. Edit them directly, then run `keyshelf up` to reconcile provider state (create new secrets, delete removed ones, sync across providers).

When you resolve an environment, imports are merged depth-first using JSON Merge Patch semantics: later values override earlier ones, and the current environment's values override all imports.

## Commands

### `keyshelf up`

Reconcile all environments against their providers. Shows a Terraform-style plan and prompts for confirmation.

```bash
keyshelf up                           # interactive: show plan, confirm, prompt for secrets
keyshelf up --apply                   # skip confirmation
keyshelf up --from-env                # read new secret values from process env vars
keyshelf up --from-file secrets.env   # read new secret values from a key=value file
```

The plan shows what will change:

```
Environment: dev
  + secret  database/password  (new)
  - secret  old/api-key
  ↻ secret  cache/token  (from base)

Environment: prod
  (no changes)
```

- `+` new secret (will prompt for value, or read from `--from-env`/`--from-file`)
- `-` removed secret (will be deleted from provider)
- `↻` imported secret from another env with a different provider (will be copied)

Environments are processed in topological order (parents before children), so imported secrets are always available when needed.

### `keyshelf init`

Initialize a new keyshelf project in the current directory. Creates `keyshelf.yml` and the `.keyshelf/environments/` directory.

```bash
keyshelf init
keyshelf init --force  # overwrite existing config
```

### `keyshelf env:create <name>`

Create a new environment.

```bash
keyshelf env:create dev
keyshelf env:create staging --import base --import shared
```

### `keyshelf env:print <env>`

Print the fully resolved config tree for an environment. Secrets are masked by default.

```bash
keyshelf env:print dev                # YAML output, secrets masked
keyshelf env:print dev --reveal       # show actual secret values
keyshelf env:print dev --format json  # JSON output
keyshelf env:print dev --format env   # KEY=VALUE pairs (uses env mapping)
```

### `keyshelf env:load <env> <file>`

Load KEY=VALUE pairs from an env file into an environment.

```bash
keyshelf env:load dev .env
keyshelf env:load dev .env --prefix database       # nest under database/
keyshelf env:load dev .env.secrets --secrets        # store as secrets
```

### `keyshelf config:get <env> <path>`

Get a resolved config value (follows imports).

```bash
keyshelf config:get dev database/host
keyshelf config:get dev database          # returns subtree as YAML
```

### `keyshelf config:list <env>`

List all config paths in a resolved environment (excludes secrets).

```bash
keyshelf config:list dev
keyshelf config:list dev --prefix database
```

### `keyshelf secret:get <env> <path>`

Retrieve a secret value from the provider.

```bash
keyshelf secret:get dev database/password
```

### `keyshelf secret:list <env>`

List all secret paths in a resolved environment.

```bash
keyshelf secret:list dev
keyshelf secret:list dev --prefix database
```

### `keyshelf run --env <env> -- <command>`

Run a command with resolved config and secrets injected as env vars. Uses the `env` mapping section to determine which variables to inject.

```bash
keyshelf run --env dev -- node server.js
keyshelf run --env prod -- docker compose up
```

## Env Mapping

The `env` section in an environment YAML file explicitly maps config/secret paths to env var names:

```yaml
values:
    database:
        host: localhost
        port: 5432
        password: !secret database/password
    app:
        name: myservice
env:
    DB_HOST: database/host
    DB_PORT: database/port
    DB_PASS: database/password
    APP_NAME: app/name
```

Only paths listed in `env` are injected as environment variables by `keyshelf run` and `keyshelf env:print --format env`. This gives you explicit control over your process environment contract.

The `env` mapping is also used by `keyshelf up --from-env` to know which process env vars to read when sourcing new secret values non-interactively.

## Project Structure

```
my-project/
  keyshelf.yml                          # project config
  .keyshelf/
    environments/
      base.yml                          # shared base config
      dev.yml                           # dev overrides (imports base)
      prod.yml                          # prod overrides (imports base)
```

Secrets are stored outside the repo by the configured provider (see [Providers](#providers)).

## Providers

Providers are pluggable backends for storing secret values. The provider is configured in `keyshelf.yml` and can be overridden per environment.

### Local (`local`)

Stores secrets as JSON on the local filesystem at `~/.config/keyshelf/<project>/secrets.json`. Good for development and single-machine setups. No external dependencies.

```yaml
provider:
    adapter: local
```

### GCP Secret Manager (`gcp-sm`)

Stores secrets in [Google Cloud Secret Manager](https://cloud.google.com/secret-manager). Uses Application Default Credentials (ADC) for authentication — run `gcloud auth application-default login` or set `GOOGLE_APPLICATION_CREDENTIALS` before use. Requires `@google-cloud/secret-manager` as a peer dependency.

```yaml
provider:
    adapter: gcp-sm
    project: my-gcp-project-id
```

Secrets are stored with IDs in the format `<env>__<path>` (slashes replaced with `__`), subject to GCP's 255-character limit.

### AWS Secrets Manager (`aws-sm`)

Stores secrets in [AWS Secrets Manager](https://aws.amazon.com/secrets-manager/). Uses the standard AWS credential chain — configure via `~/.aws/credentials`, environment variables (`AWS_PROFILE`, `AWS_REGION`), or an IAM role. Requires `@aws-sdk/client-secrets-manager` as a peer dependency.

```yaml
provider:
    adapter: aws-sm
```

Secrets are stored with names in the format `keyshelf/<name>/<env>/<path>`.

### Per-environment providers

Environments can override the global provider. This is useful when dev secrets are local but production secrets live in a cloud provider:

```yaml
# .keyshelf/environments/dev.yml
imports:
    - base
values:
    database:
        host: localhost
provider:
    adapter: local

# .keyshelf/environments/prod.yml
imports:
    - base
values:
    database:
        host: db.prod.example.com
provider:
    adapter: gcp-sm
    project: my-gcp-project-id
```

## Configuration

`keyshelf.yml` is created by `keyshelf init`:

```yaml
name: my-project
provider:
    adapter: local
```

- **name**: Project identifier, used to scope secret storage
- **provider.adapter**: Secret storage backend (see [Providers](#providers))

## Development

```bash
npm install
npm run build
npm test
npm run lint
```

## License

ISC
