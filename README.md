# keyshelf

CLI tool for managing hierarchical config values and secrets across multiple environments.

- Config values live in version-controlled YAML files
- Secret values live in external providers (local filesystem, with more planned)
- YAML files reference secrets via `!secret` tags (safe to commit)
- Environments compose via imports with JSON Merge Patch semantics

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

# Add config values
keyshelf config:add base database/port 5432
keyshelf config:add dev database/host localhost
keyshelf config:add prod database/host db.prod.example.com

# Add secrets
keyshelf secret:add dev database/password devpass123
keyshelf secret:add prod database/password prodpass456

# View resolved config
keyshelf env:print dev
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
```

- **Plain values** are stored directly in YAML (safe to commit)
- **Secret values** are stored in a provider and referenced via `!secret <path>`
- **Imports** let environments inherit and override values from other environments

When you resolve an environment, imports are merged depth-first using JSON Merge Patch semantics: later values override earlier ones, and the current environment's values override all imports.

## Commands

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
keyshelf env:print dev --format env   # KEY=VALUE pairs
```

### `keyshelf env:load <env> <file>`

Load KEY=VALUE pairs from an env file into an environment.

```bash
keyshelf env:load dev .env
keyshelf env:load dev .env --prefix database       # nest under database/
keyshelf env:load dev .env.secrets --secrets        # store as secrets
```

### `keyshelf config:add <env> <path> <value>`

Add a config value at a slash-delimited path.

```bash
keyshelf config:add dev database/host localhost
keyshelf config:add dev api/stripe/enabled true
```

### `keyshelf config:get <env> <path>`

Get a resolved config value (follows imports).

```bash
keyshelf config:get dev database/host
keyshelf config:get dev database          # returns subtree as YAML
```

### `keyshelf config:rm <env> <path>`

Remove a config value from an environment. Only removes from the specified environment, not from imports.

```bash
keyshelf config:rm dev database/host
```

### `keyshelf config:list <env>`

List all config paths in a resolved environment (excludes secrets).

```bash
keyshelf config:list dev
keyshelf config:list dev --prefix database
```

### `keyshelf secret:add <env> <path> <value>`

Store a secret in the provider and add a `!secret` reference to the environment.

```bash
keyshelf secret:add dev database/password s3cret
```

### `keyshelf secret:get <env> <path>`

Retrieve a secret value from the provider.

```bash
keyshelf secret:get dev database/password
```

### `keyshelf secret:rm <env> <path>`

Remove a secret from both the provider and the environment YAML.

```bash
keyshelf secret:rm dev database/password
```

### `keyshelf secret:list <env>`

List all secret paths in a resolved environment.

```bash
keyshelf secret:list dev
keyshelf secret:list dev --prefix database
```

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

Secrets are stored outside the repo in `~/.config/keyshelf/<project>/secrets.json` (local provider).

## Configuration

`keyshelf.yml` is created by `keyshelf init`:

```yaml
name: my-project
provider:
    adapter: local
```

- **name**: Project identifier, used to scope secret storage
- **provider.adapter**: Secret storage backend (`local` stores secrets on the local filesystem)

## Development

```bash
npm install
npm run build
npm test
npm run lint
```

## License

ISC
