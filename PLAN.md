# keyshelf — Implementation Plan

## Overview

A CLI tool for managing hierarchical config values and secrets across multiple
environments, with pluggable secret provider adapters.

**Stack**: Node.js, TypeScript, oclif (CLI), js-yaml, vitest

**Principles**:

- Config values live in version-controlled YAML files
- Secret values live in external providers (GCP SM, AWS SM, etc.)
- YAML files reference secrets via `!secret` tags (safe to commit)
- Environments compose via imports with JSON Merge Patch semantics
- Local provider stores secrets outside the repo (`~/.config/keyshelf/`)

---

## Phase 0: Project Scaffold

### 0.1 — Initialize project with TypeScript

> **Commit**: `chore: initialize project with typescript`

- `npm init -y`
- `npm i -D typescript @types/node`
- Create `tsconfig.json`
- Create `src/index.ts` placeholder
- Create `.gitignore` (node_modules, dist, coverage)
- Update `package.json` (name, version, type: module, engines: node >=20)

### 0.2 — Set up linter, formatter, editorconfig

> **Commit**: `chore: set up eslint, prettier, editorconfig`

- `npm i -D eslint @eslint/js typescript-eslint prettier eslint-config-prettier`
- Create `eslint.config.js` (flat config, extends recommended +
  typescript-eslint)
- Create `.prettierrc`:
    ```json
    {
        "singleQuote": true,
        "trailingComma": "none",
        "tabWidth": 4,
        "printWidth": 100,
        "semi": true
    }
    ```
- Create `.editorconfig`:

    ```ini
    root = true

    [*]
    indent_style = space
    indent_size = 4
    end_of_line = lf
    charset = utf-8
    trim_trailing_whitespace = true
    insert_final_newline = true

    [*.{json,yml,yaml}]
    indent_size = 2

    [*.md]
    trim_trailing_whitespace = false
    ```

- Add scripts to `package.json`: `lint`, `format`, `format:check`

### 0.3 — Set up vitest

> **Commit**: `chore: set up vitest`

- `npm i -D vitest`
- Create `vitest.config.ts`
- Add `test` and `test:watch` scripts to `package.json`
- Add a trivial passing test (`test/smoke.test.ts`) to verify the setup works

### 0.4 — Set up oclif with entry point

> **Commit**: `chore: set up oclif cli skeleton`

- `npm i @oclif/core`
- Create `bin/run.js` and `bin/dev.js` (oclif entry points)
- Configure `oclif` section in `package.json`:
    ```json
    {
        "oclif": {
            "bin": "keyshelf",
            "dirname": "keyshelf",
            "commands": "./dist/commands",
            "topicSeparator": ":"
        }
    }
    ```
- Set up build with tsup (entry: `src/cli.ts`, banner with shebang)
- Create placeholder `src/commands/` directory
- Add `build` and `prepublishOnly` scripts
- Verify `keyshelf --help` runs

### 0.5 — Create directory structure

> **Commit**: `chore: create project directory structure`

- Create directories:
    ```
    src/commands/secret/
    src/commands/config/
    src/commands/env/
    src/core/
    src/providers/
    test/core/
    test/commands/
    test/providers/
    ```
- Create `src/core/types.ts` with core type definitions:
    - `EnvironmentDefinition` (imports + values)
    - `SecretRef` class
    - `KeyshelfConfig` (project config from `keyshelf.yml`)

---

## Phase 1: Core — PathTree

### 1.1 — PathTree data structure

> **Commit**: `feat: implement PathTree with get, set, delete`

Write tests first, then implement.

`test/core/path-tree.test.ts`:

```
set and get a value at a simple path
  set("database/host", "localhost") → get("database/host") === "localhost"

set and get nested paths
  set("api/stripe/key", "sk_123") → get("api/stripe/key") === "sk_123"

get a subtree
  set("database/host", "localhost"), set("database/port", 5432)
  → get("database") === { host: "localhost", port: 5432 }

get returns undefined for missing paths

delete a value
  set then delete → get returns undefined

delete cleans up empty parent nodes

list paths under a prefix
  list("database") → ["database/host", "database/port"]

list all paths
  list() → all leaf paths

toJSON returns the internal nested object
fromJSON constructs a PathTree from a nested object
```

`src/core/path-tree.ts`:

- Internal representation: nested plain object
- Paths split on `/`
- `get(path)`, `set(path, value)`, `delete(path)`
- `list(prefix?)`, `toJSON()`, static `fromJSON(obj)`

### 1.2 — PathTree merge (JSON Merge Patch)

> **Commit**: `feat: implement PathTree merge with JSON Merge Patch semantics`

Write tests first, then implement.

`test/core/path-tree.test.ts` (new describe block):

```
merge two trees: objects merge recursively
  A: { database: { host: "a", port: 5432 } }
  B: { database: { host: "b" } }
  → { database: { host: "b", port: 5432 } }

merge: scalar replaces object

merge: object replaces scalar

merge: null removes key

merge: second tree wins on conflict

merge does not mutate either input tree
```

Add `merge(other: PathTree): PathTree` (returns new tree).

---

## Phase 2: Core — YAML with !secret tag

### 2.1 — SecretRef and YAML parsing

> **Commit**: `feat: implement YAML parser with !secret custom tag`

- `npm i js-yaml && npm i -D @types/js-yaml`

Write tests first, then implement.

`test/core/yaml.test.ts`:

```
parse plain YAML values
  "database:\n  host: localhost" → { database: { host: "localhost" } }

parse !secret tag into SecretRef
  "password: !secret database/password"
  → { password: SecretRef("database/password") }

parse nested !secret tags
  "db:\n  password: !secret db/pass" → { db: { password: SecretRef("db/pass") } }

serialize plain values to YAML

serialize SecretRef back to !secret tag
  { password: SecretRef("database/password") }
  → "password: !secret database/password\n"

round-trip: parse then serialize preserves !secret refs

parse environment definition with imports
  "imports:\n  - base\nvalues:\n  key: val"
  → { imports: ["base"], values: { key: "val" } }

parse environment definition without imports
  "values:\n  key: val"
  → { imports: [], values: { key: "val" } }
```

`src/core/yaml.ts`:

- Custom js-yaml `Type` for `!secret`
- Custom `Schema` extending `DEFAULT_SCHEMA`
- `parseEnvironment(content: string): EnvironmentDefinition`
- `serializeEnvironment(def: EnvironmentDefinition): string`

---

## Phase 3: Core — Environment I/O

### 3.1 — Environment loading and saving

> **Commit**: `feat: implement environment definition loading and saving`

Write tests first, then implement. Tests use a temp directory.

`test/core/environment.test.ts`:

```
save then load an environment round-trips correctly

load environment with imports

load environment that does not exist throws descriptive error

list environments returns names from .keyshelf/environments/

list environments returns empty array when no environments exist

save creates .keyshelf/environments/ directory if missing
```

`src/core/environment.ts`:

- `loadEnvironment(projectRoot, name): EnvironmentDefinition`
- `saveEnvironment(projectRoot, name, def): void`
- `listEnvironments(projectRoot): string[]`
- Reads/writes `.keyshelf/environments/<name>.yml`

---

## Phase 4: Core — Resolver

### 4.1 — Resolve environments with imports

> **Commit**: `feat: implement environment resolver with import merging`

Write tests first, then implement. Tests use in-memory environment definitions
(pass a `loadFn` rather than hitting the filesystem).

`test/core/resolver.test.ts`:

```
resolve environment with no imports returns values as-is

resolve environment with single import merges values
  base: { database: { port: 5432 } }
  dev imports base, adds: { database: { host: "localhost" } }
  → resolved: { database: { host: "localhost", port: 5432 } }

current environment values override imported values

import order: later imports override earlier ones
  dev imports [a, b] — b wins over a on conflict

chained imports (3 levels)
  base → staging → prod — each overrides progressively

circular import throws descriptive error
  a imports b, b imports a → CircularImportError

self-import throws error

SecretRef values survive merge (not stringified or lost)

resolver collects all SecretRef paths from resolved tree
  → returns { values: {...}, secretRefs: ["db/password", "api/key"] }
```

`src/core/resolver.ts`:

- `resolve(envName, loadFn): { values: object, secretRefs: string[] }`
- Depth-first recursive import resolution
- Cycle detection via visited set
- Uses PathTree for merging at each level
- Walks final tree to collect SecretRef instances

---

## Phase 5: Providers

### 5.1 — SecretProvider interface

> **Commit**: `feat: define SecretProvider interface`

`src/providers/provider.ts`:

```ts
interface SecretProvider {
    get(env: string, path: string): Promise<string>;
    set(env: string, path: string, value: string): Promise<void>;
    delete(env: string, path: string): Promise<void>;
    list(env: string, prefix?: string): Promise<string[]>;
}
```

### 5.2 — Local filesystem provider

> **Commit**: `feat: implement local filesystem secret provider`

Stores secrets in `~/.config/keyshelf/<project>/secrets.json`, scoped by
environment. NOT inside the repo — safe from accidental commits.

The project name comes from `keyshelf.yml` config.

Write tests first, then implement. Tests use a temp directory as the config
root.

`test/providers/local.test.ts`:

```
set and get a secret

get missing secret throws

delete a secret

delete missing secret throws

list secrets for an environment

list secrets with prefix filter

list returns empty array when no secrets exist

secrets are scoped by environment
  set in "dev" → not visible in "prod"

set overwrites existing secret

data persists across provider instances (file-backed)
```

`src/providers/local.ts`:

- Constructor takes `configDir` (defaults to `~/.config/keyshelf/<project>`)
- Reads/writes a single JSON file per project
- Structure: `{ [env]: { [path]: value } }`

---

## Phase 6: CLI Commands

### 6.1 — `init` command

> **Commit**: `feat: implement init command`

Write tests first. Tests run the command against a temp directory.

`test/commands/init.test.ts`:

```
creates keyshelf.yml with default config
creates .keyshelf/environments/ directory
keyshelf.yml contains provider config with local as default
errors if keyshelf.yml already exists
--force overwrites existing keyshelf.yml
```

`src/commands/init.ts`:

- Creates `keyshelf.yml`:
    ```yaml
    name: <directory-name>
    provider:
        adapter: local
    ```
- Creates `.keyshelf/environments/` directory

### 6.2 — `env:create` command

> **Commit**: `feat: implement env:create command`

`test/commands/env/create.test.ts`:

```
creates environment YAML file with empty values
creates environment YAML file with --import flag
supports multiple --import flags
errors if environment already exists
```

`src/commands/env/create.ts`:

- `keyshelf env:create <name> [--import <env>...]`
- Creates `.keyshelf/environments/<name>.yml`

### 6.3 — `config:add` and `config:get` commands

> **Commit**: `feat: implement config:add and config:get commands`

`test/commands/config/add.test.ts`:

```
adds a config value to environment YAML at correct path
creates nested structure for deep paths (a/b/c)
adds to existing values without overwriting siblings
errors if environment does not exist
```

`test/commands/config/get.test.ts`:

```
gets a config value from environment
gets a value inherited from an imported environment
local value overrides imported value
returns subtree when path points to an object
errors if path not found
```

### 6.4 — `config:rm` and `config:list` commands

> **Commit**: `feat: implement config:rm and config:list commands`

`test/commands/config/rm.test.ts`:

```
removes a config value from environment YAML
cleans up empty parent nodes after removal
errors if path not found
does not affect imported values (only removes from current env)
```

`test/commands/config/list.test.ts`:

```
lists all config paths in resolved environment
lists paths under a prefix
excludes !secret refs from output
shows inherited values from imports
```

### 6.5 — `secret:add` and `secret:get` commands

> **Commit**: `feat: implement secret:add and secret:get commands`

`test/commands/secret/add.test.ts`:

```
stores value in secret provider
adds !secret ref to environment YAML
overwrites existing secret in provider
updates existing !secret ref if path already exists
errors if environment does not exist
```

`test/commands/secret/get.test.ts`:

```
fetches secret value from provider
resolves secret through imported environment
errors if secret path not found
```

### 6.6 — `secret:rm` and `secret:list` commands

> **Commit**: `feat: implement secret:rm and secret:list commands`

`test/commands/secret/rm.test.ts`:

```
deletes secret from provider
removes !secret ref from environment YAML
errors if secret not found
```

`test/commands/secret/list.test.ts`:

```
lists all secret paths in resolved environment
lists secrets under a prefix
shows inherited secrets from imports
```

### 6.7 — `env:print` command

> **Commit**: `feat: implement env:print command`

`test/commands/env/print.test.ts`:

```
prints resolved config tree as YAML
masks secret values by default (shows "********")
--reveal flag shows actual secret values
--format json outputs JSON
--format env outputs KEY=VALUE pairs (flattened with _ separator)
includes inherited values from imports
```

### 6.8 — `env:load` command

> **Commit**: `feat: implement env:load command`

`test/commands/env/load.test.ts`:

```
loads KEY=VALUE pairs as config values
skips comments and blank lines
handles quoted values
--prefix flag nests all values under a path
--secrets flag treats all values as secrets (stores in provider)
errors if env file not found
```

---

## Phase 7: Polish

### 7.1 — Project config validation

> **Commit**: `feat: validate keyshelf.yml on load`

```
missing keyshelf.yml shows actionable error ("run keyshelf init")
invalid YAML shows parse error with line number
missing required fields show specific error
unknown adapter name shows available adapters
```

### 7.2 — Error handling and UX

> **Commit**: `feat: improve error messages and help text`

- Every command has a description and examples in `--help`
- Errors show what went wrong and suggest how to fix it
- Secret values never appear in error messages or stack traces

### 7.3 — README

> **Commit**: `docs: add README with usage examples`

---

## Dependency Graph

Each phase builds on the previous. Within a phase, subtasks are sequential.

```
Phase 0: Project Scaffold
    0.1 → 0.2 → 0.3 → 0.4 → 0.5
                                 ↓
Phase 1: PathTree ←──────────────┘
    1.1 → 1.2
            ↓
Phase 2: YAML ←─┘
    2.1
     ↓
Phase 3: Environment
    3.1
     ↓
Phase 4: Resolver
    4.1
     ↓
Phase 5: Providers
    5.1 → 5.2
            ↓
Phase 6: CLI Commands ←─┘
    6.1 → 6.2 → 6.3 → 6.4 → 6.5 → 6.6 → 6.7 → 6.8
                                                    ↓
Phase 7: Polish ←───────────────────────────────────┘
    7.1 → 7.2 → 7.3
```

**Total commits**: ~22
