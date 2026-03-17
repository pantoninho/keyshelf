# Keyshelf Integration Guide

This guide walks you through setting up keyshelf in a small project from scratch.

## Prerequisites

- Node.js >= 20
- npm

## Install

```bash
npm install -g keyshelf
```

Or use it without installing globally via `npx`:

```bash
npx keyshelf <command>
```

## Step 1: Initialize your project

In your project root:

```bash
keyshelf init
```

This creates:

- `keyshelf.yml` — project config (commit this)
- `.keyshelf/environments/` — where environment files live (commit these too)

Your `keyshelf.yml` will look like:

```yaml
name: my-project
provider:
    adapter: local
```

The `local` adapter stores secrets in `~/.config/keyshelf/my-project/secrets.json` on your machine — never in the repo.

## Step 2: Create environments

A typical setup has a shared base with dev and prod overrides:

```bash
keyshelf env:create base
keyshelf env:create dev --import base
keyshelf env:create prod --import base
```

This creates three YAML files under `.keyshelf/environments/`. The `dev` and `prod` environments inherit everything from `base` and can override specific values.

## Step 3: Add shared configuration

Add values that are the same across environments to `base`:

```bash
keyshelf config:add base app/name "my-app"
keyshelf config:add base app/port 3000
keyshelf config:add base database/port 5432
keyshelf config:add base database/name myapp_db
```

## Step 4: Add environment-specific config

Override or add values per environment:

```bash
keyshelf config:add dev database/host localhost
keyshelf config:add prod database/host db.prod.example.com
keyshelf config:add prod app/port 8080
```

## Step 5: Add secrets

Secrets are stored externally and referenced in YAML via `!secret` tags:

```bash
keyshelf secret:add dev database/password devpass123
keyshelf secret:add prod database/password super-secret-prod-pw

keyshelf secret:add dev api/stripe-key sk_test_abc123
keyshelf secret:add prod api/stripe-key sk_live_xyz789
```

After this, your `.keyshelf/environments/dev.yml` looks like:

```yaml
imports:
    - base
values:
    database:
        host: localhost
        password: !secret database/password
    api:
        stripe-key: !secret api/stripe-key
```

The `!secret` references are safe to commit — actual values live in the provider.

## Step 6: View your resolved config

```bash
# YAML output (secrets masked)
keyshelf print --env dev

# Reveal secrets
keyshelf print --env dev --reveal

# JSON output
keyshelf print --env dev --format json

# KEY=VALUE pairs (for .env files, Docker, etc.)
keyshelf print --env prod --format env
```

Example output of `keyshelf print --env dev`:

```yaml
app:
    name: my-app
    port: 3000
database:
    host: localhost
    port: 5432
    name: myapp_db
    password: '********'
api:
    stripe-key: '********'
```

## Step 7: Use in your application

### Option A: Generate a .env file

```bash
keyshelf print --env dev --format env --reveal > .env
```

Then load it with your framework's usual mechanism (dotenv, Docker `--env-file`, etc.).

Make sure `.env` is in your `.gitignore`.

### Option B: Inject into a process

```bash
eval $(keyshelf print --env dev --format env --reveal) node server.js
```

### Option C: Export to a Docker Compose override

```bash
keyshelf print --env dev --format env --reveal > .env
# docker-compose.yml references .env automatically
docker compose up
```

## Importing existing .env files

If you already have a `.env` file, load it into keyshelf:

```bash
# Load plain config values
keyshelf import --env dev .env

# Load everything as secrets
keyshelf import --env dev .env.secrets --secrets

# Nest under a prefix
keyshelf import --env dev .env.database --prefix database
```

## Querying specific values

```bash
# Get a single config value
keyshelf config:get dev database/host
# → localhost

# Get a subtree
keyshelf config:get dev database
# → host: localhost
# → port: 5432
# → name: myapp_db
# → password: !secret database/password

# Get a secret value
keyshelf secret:get dev database/password
# → devpass123

# List all config paths
keyshelf config:list dev
# → app/name
# → app/port
# → database/host
# → database/port
# → database/name

# List secret paths
keyshelf secret:list dev
# → database/password
# → api/stripe-key
```

## How imports work

Environments merge using JSON Merge Patch (RFC 7396):

- Later imports override earlier ones
- The current environment's values override all imports
- You can chain imports: `staging --import base --import dev`

```
base.yml          dev.yml (imports: [base])
─────────         ─────────────────────────
app/port: 3000    database/host: localhost   ← adds new value
database/port: 5432                          ← inherited from base
                  app/port: 3001             ← overrides base
```

## What to commit

```
keyshelf.yml                     # commit
.keyshelf/environments/*.yml     # commit (secrets are only references)
.env                             # DO NOT commit (contains real values)
```

## Using GCP Secret Manager (production)

For production workloads, use GCP Secret Manager instead of local storage:

```bash
keyshelf init --adapter gcp-sm --project my-gcp-project
```

Or configure per-environment in the YAML:

```yaml
# .keyshelf/environments/prod.yml
imports:
    - base
provider:
    adapter: gcp-sm
    project: my-gcp-project
values:
    database:
        password: !secret database/password
```

This lets you use `local` for dev and `gcp-sm` for prod.

## Example project layout

```
my-app/
├── keyshelf.yml
├── .keyshelf/
│   └── environments/
│       ├── base.yml
│       ├── dev.yml
│       ├── staging.yml
│       └── prod.yml
├── .gitignore          # includes .env
├── src/
│   └── ...
├── package.json
└── docker-compose.yml
```

## Quick reference

| Task                       | Command                                            |
| -------------------------- | -------------------------------------------------- |
| Initialize project         | `keyshelf init`                                    |
| Create environment         | `keyshelf env:create <name> [--import <base>]`     |
| Add config value           | `keyshelf config:add <env> <path> <value>`         |
| Add secret                 | `keyshelf secret:add <env> <path> <value>`         |
| Get config value           | `keyshelf config:get <env> <path>`                 |
| Get secret value           | `keyshelf secret:get <env> <path>`                 |
| Remove config value        | `keyshelf config:rm <env> <path>`                  |
| Remove secret              | `keyshelf secret:rm <env> <path>`                  |
| Print resolved environment | `keyshelf print --env <env> [--reveal] [--format]` |
| Load .env file             | `keyshelf import --env <env> <file> [--secrets]`   |
| List config paths          | `keyshelf config:list <env> [--prefix <p>]`        |
| List secret paths          | `keyshelf secret:list <env> [--prefix <p>]`        |
