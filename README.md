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
db:
  host: localhost
  port: 5432
  password: !secret ''
api:
  key: !secret ''
  url: https://api.example.com
analytics:
  key: !secret
    optional: true
```

Plain values have defaults. `!secret` marks values that must come from a provider. `optional: true` allows secrets to be missing.

### 2. Create an environment file

```yaml
# .keyshelf/production.yaml
default-provider:
  name: age
  identityFile: ./keys/production.txt
  secretsDir: ./.keyshelf/secrets/production

db:
  host: prod-db.example.com
  port: 5433
```

The `default-provider` block configures the default secret provider. Secrets without explicit overrides are resolved through it. Config values can be overridden as plaintext.

You can also bind individual secrets to specific providers:

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

Each app declares exactly which keys it consumes and what env var names to use.

### 4. Run your app

```bash
cd apps/api
keyshelf run --env production -- node server.js
```

This resolves all values, maps them to env vars, and spawns the command with them injected.

## CLI commands

### `keyshelf run --env <env> -- <command>`

Resolve all values, map through `.env.keyshelf`, and run a command with env vars injected. Forwards the child process exit code.

```bash
keyshelf run --env dev -- npm start
keyshelf run --env production -- node server.js
```

### `keyshelf set --env <env> [--provider <provider>] <key/path> [--value <value>]`

Set a value in an environment file.

```bash
# Plaintext (stored in .keyshelf/<env>.yaml)
keyshelf set --env dev db/host dev-db.local

# Via provider
keyshelf set --env production --provider age db/password --value "s3cret"

# Interactive (prompts for value)
keyshelf set --env production --provider age db/password

# From pipe
echo "s3cret" | keyshelf set --env production --provider age db/password
```

### `keyshelf import --env <env> [--provider <provider>] --file <env-file>`

Bulk import from a `.env` file. Uses `.env.keyshelf` as a reverse lookup to map `ENV_VAR` names back to key paths.

```bash
keyshelf import --env dev --file .env
keyshelf import --env production --provider age --file .env.production
```

With `--provider`, keys marked as `!secret` in the schema are stored via the provider. Config keys are always written as plaintext to the env file.

## Resolution order

For each key, values are resolved in this order:

1. **Env file explicit override** — plaintext or provider-tagged value
2. **Default provider** — unbound secrets use the env's default provider
3. **Schema default** — config keys only (not secrets)
4. **Error or skip** — required keys error, optional secrets are skipped

## Providers

### age

Local encrypted secrets using [age](https://age-encryption.org/). Each secret is stored as a separate `.age` file.

```yaml
# .keyshelf/dev.yaml
default-provider:
  name: age
  identityFile: ./keys/dev.txt
  secretsDir: ./.keyshelf/secrets/dev
```

Generate a new identity:

```javascript
import { generateIdentity, identityToRecipient } from 'keyshelf';

const identity = await generateIdentity();
const recipient = await identityToRecipient(identity);
// Save identity to file, share recipient with team
```

## Programmatic API

```javascript
import { loadConfig, resolve, validate, createDefaultRegistry } from 'keyshelf';

const config = await loadConfig('./apps/api', 'production');
const registry = createDefaultRegistry();

// Check for errors first
const errors = await validate({
  schema: config.schema,
  env: config.env,
  registry,
});
if (errors.length > 0) {
  console.error(errors);
}

// Resolve all values
const resolved = await resolve({
  schema: config.schema,
  env: config.env,
  registry,
});
// [{ path: 'db/host', value: 'prod-db.example.com' }, ...]
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
