# keyshelf

A CLI config and secrets manager with pluggable backends. Define all your keys in a single `keyshelf.yaml` file, store secrets encrypted locally or in cloud secret managers, and inject them into your processes at runtime.

## Install

```bash
npm install -g keyshelf
```

Or from source:

```bash
git clone <repo-url> && cd keyshelf
npm install && npm run build
npm link
```

Requires Node.js 20+.

## Quick Start

```bash
# Initialize a project (generates an age keypair)
keyshelf init my-app

# Set a plaintext value
keyshelf set database/url postgres://localhost/db

# Set an encrypted secret (stored as ciphertext in keyshelf.yaml)
keyshelf set api/key s3cret --provider age

# Set a secret in AWS Secrets Manager for production
keyshelf set database/password hunter2 --env production --provider awssm

# Read a value back
keyshelf get api/key
keyshelf get database/password --env production

# Run a command with all keys injected as env vars
keyshelf run --env production -- node server.js

# Export keys as dotenv or JSON
keyshelf export --env production
keyshelf export --env production --format json
```

Key paths are converted to environment variables: `database/url` becomes `DATABASE_URL`, `api/secret-key` becomes `API_SECRET_KEY`.

## Configuration

`keyshelf.yaml` lives at the root of your project and is designed to be committed to version control:

```yaml
project: my-app
publicKey: age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p
pulumi:
  cwd: ./infra

keys:
  database/url:
    default: postgres://localhost/db
    staging: !awssm my-app/staging/database/url
    production: !awssm my-app/production/database/url

  api/key:
    default: !age |
      -----BEGIN AGE ENCRYPTED FILE-----
      YWdlLWVuY3J5cHRpb24...
      -----END AGE ENCRYPTED FILE-----

  cdn/endpoint:
    default: !pulumi prod.cdnEndpoint

  auth/token:
    production: !gcsm projects/my-gcp-project/secrets/my-app__production__auth__token
```

| Field | Description |
|---|---|
| `project` | Project name. Used as a prefix in cloud secret stores and to locate the age private key. |
| `publicKey` | age public key (`age1...`). Required for the age provider. |
| `pulumi` | Optional. `cwd` points to the Pulumi project directory. Required for the `!pulumi` provider. |
| `keys` | Map of key paths to environment-specific values. |

### Values

- **Plain strings** — stored and returned as-is, no encryption. Useful for non-sensitive defaults.
- **Tagged values** — prefixed with a provider tag (`!age`, `!awssm`, `!gcsm`, `!pulumi`). Resolved at runtime by the corresponding provider.

### Environments

Each key can have values for any number of named environments, plus an optional `default` fallback. When resolving a key:

1. If an env-specific value exists, use it
2. Otherwise, fall back to `default`
3. Error if neither exists

Environment names are arbitrary strings — use whatever fits your workflow (`dev`, `staging`, `production`, `ci`, etc.).

## Providers

### `!age` — Local Encryption

Encrypts secrets with [age](https://age-encryption.org/) and stores the ciphertext directly in `keyshelf.yaml`. Uses a pure JavaScript implementation — no external tools needed.

- **Public key** — stored in `keyshelf.yaml`, used to encrypt. Anyone with the repo can add secrets.
- **Private key** — stored at `~/.config/keyshelf/<project>/key` (mode `0600`), never committed. Required to decrypt.

```bash
keyshelf set api/key s3cret --provider age
```

To onboard a team member or set up CI, share the private key through a secure channel and place it at the same path.

### `!awssm` — AWS Secrets Manager

Stores secrets in AWS Secrets Manager. Uses ambient AWS credentials (env vars, `~/.aws/credentials`, instance roles, etc.).

```bash
keyshelf set database/password hunter2 --env production --provider awssm
```

Secrets are named `<project>/<env>/<key>` (e.g., `my-app/production/database/password`).

### `!gcsm` — GCP Secret Manager

Stores secrets in Google Cloud Secret Manager. Uses Application Default Credentials. The GCP project is resolved from `GOOGLE_CLOUD_PROJECT` or `gcloud config get-value project`.

```bash
keyshelf set database/password hunter2 --env production --provider gcsm
```

Secret IDs use `__` as separators (e.g., `my-app__production__database__password`), so key paths must not contain `__`.

### `!pulumi` — Pulumi Stack Outputs (read-only)

Pulls values from Pulumi stack outputs. Requires the `pulumi` CLI on your PATH and a `pulumi.cwd` entry in your config.

```yaml
pulumi:
  cwd: ./infra

keys:
  api/endpoint:
    default: !pulumi prod.apiEndpoint
```

The reference format is `<stack>.<outputName>`. This provider is read-only — values are set through your Pulumi program, not through keyshelf.

## Commands

### `keyshelf init <project>`

Creates `keyshelf.yaml` and generates an age keypair.

- Stores the private key at `~/.config/keyshelf/<project>/key`
- Writes the public key into `keyshelf.yaml`

### `keyshelf set <key> [value]`

Sets a key's value. If `value` is omitted, reads from stdin.

| Flag | Description | Default |
|---|---|---|
| `--env` | Target environment | `default` |
| `--provider` | Storage backend (`age`, `awssm`, `gcsm`) | none (plaintext) |

```bash
# Plaintext
keyshelf set database/url postgres://localhost/db

# Encrypted with age
keyshelf set api/key --provider age <<< "s3cret"

# Stored in AWS Secrets Manager
keyshelf set database/password hunter2 --env prod --provider awssm
```

### `keyshelf get <key>`

Resolves and prints a key's value to stdout.

| Flag | Description | Default |
|---|---|---|
| `--env` | Target environment | `default` |

Falls back to the `default` environment if no env-specific value exists.

### `keyshelf run --env <env> -- <command...>`

Resolves all keys for the given environment and spawns the command with them as environment variables.

| Key path | Env var |
|---|---|
| `database/url` | `DATABASE_URL` |
| `api/secret-key` | `API_SECRET_KEY` |
| `app.port` | `APP_PORT` |

Exits with the subprocess's exit code.

```bash
keyshelf run --env production -- node server.js
keyshelf run --env staging -- docker compose up
```

### `keyshelf export --env <env>`

Resolves all keys and prints them to stdout.

| Flag | Description | Default |
|---|---|---|
| `--format` | Output format (`dotenv`, `json`) | `dotenv` |

```bash
keyshelf export --env prod > .env
keyshelf export --env staging --format json | jq .
```

## Development

```bash
npm install            # install dependencies
npm run dev -- <args>  # run without building
npm test               # run tests
npm run build          # build to dist/
```

### E2E Tests

Cloud provider e2e tests are opt-in via environment variables:

```bash
KEYSHELF_AWS_E2E=1 npm test    # run AWS Secrets Manager e2e tests
KEYSHELF_GCP_E2E=1 npm test    # run GCP Secret Manager e2e tests
KEYSHELF_PULUMI_E2E=1 npm test # run Pulumi e2e tests
```
