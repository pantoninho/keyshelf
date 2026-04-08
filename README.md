# keyshelf

Config and secrets management for monorepos. Declarative schema, per-environment overrides, pluggable secret providers.

## How it works

1. **Root schema** (`keyshelf.yaml`) — defines all keys, their defaults, and which are secrets
2. **Environment files** (`.keyshelf/<env>.yaml`) — override values and bind secrets to providers
3. **App mapping** (`.env.keyshelf`) — maps key paths to `ENV_VAR` names per app

```
monorepo/
├── keyshelf.yaml            # schema + defaults
├── .keyshelf/
│   ├── dev.yaml             # dev environment
│   └── production.yaml      # production environment
├── apps/
│   ├── api/
│   │   └── .env.keyshelf    # API app mapping
│   └── worker/
│       └── .env.keyshelf    # Worker app mapping
```

## Quick start

```bash
npm install keyshelf
```

### 1. Define your schema

```yaml
# keyshelf.yaml
keys:
  db:
    host: localhost
    port: 5432
    password: !secret
  api:
    key: !secret
    url: https://api.example.com
  analytics:
    key: !secret
      optional: true
```

The `keys:` block declares every key in your project. Plain values (`localhost`, `5432`) are config with defaults. `!secret` marks values that must come from a provider at resolve time. Add `optional: true` to allow a secret to be missing without erroring.

### 2. Create an environment file

```yaml
# .keyshelf/dev.yaml
default-provider:
  name: age
  identityFile: ./keys/dev.txt
  secretsDir: ./.keyshelf/secrets/dev

db:
  host: dev-db.local
```

The `default-provider` block tells keyshelf how to resolve any `!secret` key that doesn't have an explicit override. Config values (like `db/host` above) can be overridden as plaintext.

You can also bind individual secrets to a specific provider, overriding the default:

```yaml
db:
  password: !age
    identityFile: ./keys/other.txt
    secretsDir: ./other-secrets
```

### 3. Create an app mapping

```ini
# apps/api/.env.keyshelf
DB_HOST=db/host
DB_PORT=db/port
DB_PASSWORD=db/password
API_KEY=api/key
API_URL=api/url
```

Each app declares exactly which keys it consumes and what env var names to use. The `.env.keyshelf` file is required — it controls which keys are injected into your app.

### 4. Run your app

```bash
cd apps/api
keyshelf run --env dev -- node server.js
```

This resolves all mapped values, injects them as environment variables, and spawns the command.

## Resolution order

For each key, values are resolved in this order:

1. **Env file explicit override** — plaintext value in `.keyshelf/<env>.yaml`
2. **Env file provider override** — tagged value (e.g. `!age`) in `.keyshelf/<env>.yaml`
3. **Default provider** — unbound `!secret` keys use the env's `default-provider`
4. **Schema default** — plain config keys only (not secrets)
5. **Error or skip** — required keys error, optional secrets are skipped

## CLI commands

### `keyshelf run`

Resolve all values, map through `.env.keyshelf`, and run a command with env vars injected. Forwards the child process exit code.

Environment variables already set in your shell take precedence over resolved values. This means you can always override any key by setting the corresponding env var explicitly:

```bash
keyshelf run --env dev -- npm start
keyshelf run --env production -- node server.js
keyshelf run --env dev --map ./custom-mapping.env.keyshelf -- npm start

# Override a resolved value
DB_HOST=localhost keyshelf run --env production -- node server.js
```

### `keyshelf set`

Set a value in an environment file.

```bash
# Plaintext override (stored in .keyshelf/<env>.yaml)
keyshelf set --env dev db/host --value dev-db.local

# Via provider
keyshelf set --env production --provider age db/password --value "s3cret"

# Interactive (prompts for value)
keyshelf set --env production --provider age db/password

# From pipe
echo "s3cret" | keyshelf set --env production --provider age db/password
```

### `keyshelf ls`

List keys defined in the schema. Shows key paths, types (config/secret), and source info.

```bash
# Schema only (no environment context)
keyshelf ls

# With environment — shows where each value comes from
keyshelf ls --env dev

# Reveal actual resolved values (requires --env)
keyshelf ls --env production --reveal

# With a specific mapping file
keyshelf ls --env dev --map ./custom-mapping.env.keyshelf
```

### `keyshelf import`

Bulk import from a `.env` file. Uses `.env.keyshelf` as a reverse lookup to map `ENV_VAR` names back to key paths.

```bash
keyshelf import --env dev --file .env
keyshelf import --env production --provider age --file .env.production
```

With `--provider`, keys marked as `!secret` in the schema are stored via the provider. Config keys are always written as plaintext to the env file.

## Providers

### age

Local encrypted secrets using [age](https://age-encryption.org/). Each secret is stored as a separate `.age` file on disk.

```yaml
# .keyshelf/production.yaml
default-provider:
  name: age
  identityFile: ./keys/production.txt
  secretsDir: ./.keyshelf/secrets/production
```

| Option         | Description                                       |
| -------------- | ------------------------------------------------- |
| `identityFile` | Path to the age identity (private key) file       |
| `secretsDir`   | Directory where `.age` encrypted files are stored |

Generate a new identity:

```javascript
import { generateIdentity, identityToRecipient } from "keyshelf";

const identity = await generateIdentity();
const recipient = await identityToRecipient(identity);
// Save identity to file, share recipient with team
```

### gcp (Google Cloud Secret Manager)

Stores secrets in GCP Secret Manager. Secret names follow the convention `keyshelf__<env>__<key>` (slashes replaced with `__`).

```yaml
# .keyshelf/production.yaml
default-provider:
  name: gcp
  project: my-gcp-project
```

| Option    | Description               |
| --------- | ------------------------- |
| `project` | GCP project ID (required) |

Secrets are created automatically on first `keyshelf set`. Requires GCP credentials configured in the environment (e.g. `GOOGLE_APPLICATION_CREDENTIALS` or `gcloud auth`).

### sops

SOPS-inspired single-file encrypted secrets using [age](https://age-encryption.org/) encryption. All secrets for an environment are stored in one JSON file, with each value individually encrypted using AES-256-GCM and a shared data key that is itself encrypted with age.

```yaml
# .keyshelf/production.yaml
default-provider:
  name: sops
  identityFile: ./keys/production.txt
  secretsFile: ./.keyshelf/secrets/production.json
```

| Option         | Description                                              |
| -------------- | -------------------------------------------------------- |
| `identityFile` | Path to the age identity (private key) file              |
| `secretsFile`  | Path to the JSON file where encrypted secrets are stored |

The secrets file is created automatically on first `keyshelf set`. It contains all encrypted entries, the age-encrypted data key, and an HMAC for tamper detection. Unlike the `age` provider (one file per secret), `sops` keeps everything in a single file, which can be easier to manage and commit.

## Schema reference

### `keyshelf.yaml`

```yaml
# Optional: global default provider (used if env file doesn't set one)
default-provider:
  name: age
  identityFile: ./keys/default.txt
  secretsDir: ./.keyshelf/secrets/default

keys:
  # Config key with default value
  db/host: localhost

  # Nested keys (equivalent to db/host, db/port)
  db:
    host: localhost
    port: 5432

  # Required secret (must be resolved via provider)
  db:
    password: !secret

  # Optional secret (skipped if no value available)
  analytics:
    key: !secret
      optional: true
```

### `.keyshelf/<env>.yaml`

```yaml
# Default provider for all unbound secrets in this env
default-provider:
  name: age
  identityFile: ./keys/production.txt
  secretsDir: ./.keyshelf/secrets/production

# Plaintext overrides
db:
  host: prod-db.example.com

# Per-key provider override
db:
  password: !gcp
    project: my-gcp-project
```

### `.env.keyshelf`

```ini
# Maps key paths to environment variable names
DB_HOST=db/host
DB_PORT=db/port
DB_PASSWORD=db/password
API_KEY=api/key
```

## What to commit

| Path                   | Commit? | Notes                                                                                |
| ---------------------- | ------- | ------------------------------------------------------------------------------------ |
| `keyshelf.yaml`        | Yes     | Key declarations and defaults                                                        |
| `.keyshelf/<env>.yaml` | Depends | Safe if it only has plaintext config. Avoid committing if it has sensitive overrides |
| `.keyshelf/secrets/`   | No      | Contains encrypted `.age` files — add to `.gitignore`                                |
| `keys/*.txt`           | No      | Age identity (private key) files — add to `.gitignore`                               |
| `.env.keyshelf`        | Yes     | App-level key mappings, no secret values                                             |

## Programmatic API

```javascript
import { loadConfig, resolve, validate, createDefaultRegistry } from "keyshelf";

const config = await loadConfig("./apps/api", "production");
const registry = createDefaultRegistry();

// Check for errors first
const errors = await validate({
  schema: config.schema,
  env: config.env,
  envName: "production",
  registry
});
if (errors.length > 0) {
  console.error(errors);
}

// Resolve all values
const resolved = await resolve({
  schema: config.schema,
  env: config.env,
  envName: "production",
  registry
});
// [{ path: 'db/host', value: 'prod-db.example.com' }, ...]
```

## Editor setup

YAML editors and linters may report `unknown tag !secret` (or `!age`, `!gcp`, `!sops`) warnings on keyshelf files. This is expected — these are custom YAML tags that keyshelf handles at parse time.

### VS Code (YAML extension by Red Hat)

Add to `.vscode/settings.json`:

```json
{
  "yaml.customTags": [
    "!secret",
    "!secret mapping",
    "!age",
    "!age mapping",
    "!gcp",
    "!gcp mapping",
    "!aws",
    "!aws mapping",
    "!sops",
    "!sops mapping"
  ]
}
```

### JetBrains (IntelliJ, WebStorm)

Custom YAML tags are recognized automatically — no configuration needed.

### yamllint

Add to `.yamllint.yml`:

```yaml
rules:
  truthy:
    allowed-values: ["true", "false"]
  custom-tags:
    - "!secret"
    - "!secret mapping"
    - "!age"
    - "!age mapping"
    - "!gcp"
    - "!gcp mapping"
    - "!aws"
    - "!aws mapping"
    - "!sops"
    - "!sops mapping"
```

## Development

```bash
npm install
npm test           # run tests
npm run dev        # run CLI via tsx
npm run build      # build with tsup
npm run lint       # eslint
npm run format     # prettier
npm run typecheck  # tsc --noEmit
```

## License

MIT
