# keyshelf

Config and secrets management for monorepos. One TypeScript file declares every key in your project: where its value comes from, which environments override it, which group it belongs to, and which provider holds the secret.

## Mental model

Every key is a **record**. A record has:

- a **kind** — `config` (plaintext) or `secret` (must come from a provider)
- an optional **group** — `app`, `ci`, `ops`, … a label you can filter on at runtime
- a **default binding** (`value` / `default`) — what to use when no env-specific override applies
- an optional **`values` map** — per-env overrides, keyed by names from your `envs` list

There is one declaration per key, in one file. No cross-file overrides, no per-env defaults — the full story for every key is local to its declaration.

```ts
db: {
  host: "localhost",                                  // plaintext config, default for every env
  port: 5432,
  password: secret({                                  // secret, env-specific provider bindings
    group: "app",
    default: age({ identityFile: "./keys/dev.txt", secretsDir: "./secrets" }),
    values: {
      production: gcp({ project: "myproj" })
    }
  })
}
```

## Install

```sh
npm install keyshelf
```

Requires Node 20+. The CLI is invoked as `keyshelf`.

## Quick start

### 1. Declare your config

```ts
// keyshelf.config.ts (at the repo root)
import { defineConfig, config, secret, age, gcp } from "keyshelf/config";

export default defineConfig({
  name: "myapp",
  envs: ["dev", "staging", "production"],
  groups: ["app", "ci"],

  keys: {
    log: {
      level: "info",
      format: "json"
    },
    db: {
      host: config({
        default: "localhost",
        values: { production: "prod-db.internal" }
      }),
      port: 5432,
      password: secret({
        group: "app",
        default: age({ identityFile: "./keys/dev.txt", secretsDir: "./secrets" }),
        values: {
          production: gcp({ project: "myproj" })
        }
      })
    },
    github: {
      token: secret({
        group: "ci",
        value: age({ identityFile: "./keys/ci.txt", secretsDir: "./secrets" })
      })
    }
  }
});
```

### 2. Map keys to env-var names per app

```ini
# apps/api/.env.keyshelf
DB_HOST=db/host
DB_PORT=db/port
DB_PASSWORD=db/password
LOG_LEVEL=log/level

# Templates compose multiple keys into one env var
DB_URL=postgres://${db/host}:${db/port}/mydb
```

Each app declares exactly which keys it consumes and what env var names to use.

### 3. Run your app

```sh
cd apps/api
keyshelf run --env dev -- node server.js
```

This loads the config, resolves every mapped key (decrypting secrets through their bound providers), and spawns the command with those values injected as env vars.

## Records

### `config({ ... })` — plaintext values

```ts
config({
  group?: string;
  optional?: boolean;
  description?: string;
  value?: string | number | boolean;        // envless binding; alias of default
  default?: string | number | boolean;      // base binding; overridden by values entries
  values?: { [env]: string | number | boolean };
});
```

A bare scalar is sugar for `config({ value: <scalar> })`:

```ts
log: {
  level: "info";
}
// equivalent to
log: {
  level: config({ value: "info" });
}
```

Use the explicit factory whenever you need `group`, `values`, `optional`, or `description`.

### `secret({ ... })` — values backed by a provider

```ts
secret({
  group?: string;
  optional?: boolean;
  description?: string;
  value?: ProviderRef;                      // envless binding; alias of default
  default?: ProviderRef;
  values?: { [env]: ProviderRef };
});
```

Every binding on a `secret` record must be a provider call (`age(...)`, `gcp(...)`, `sops(...)`). Plaintext secrets are not supported — if you want a non-sensitive value, use `config(...)`.

`secret(...)` with no binding at all is rejected at validation time. A binding must be reachable for the active env (either via `values[env]`, or via `default`/`value`), unless the record is `optional: true`.

### Namespaces

Object literals are **namespaces**, not records. They flatten into `/`-joined paths:

```ts
keys: {
  db: { host: "localhost", port: 5432 }
}
// declares db/host and db/port
```

You can also write paths inline as strings — handy for shallow configs:

```ts
keys: {
  "db/host": "localhost",
  "db/port": 5432
}
```

A path is either a leaf (a record) or a namespace (a nested object), never both. `foo: 'bar'` and `foo: { x: 'y' }` declared together is a duplicate-path error.

## Resolution

For each key, given an active `envName`:

1. If `values[envName]` is set → use that binding.
2. Else if `value` / `default` is set → use that binding.
3. Else if `optional: true` → skip (no value emitted).
4. Else → error.

`value` and `default` are aliases. Setting both on the same record is a validation error. The two names exist purely for legibility — `value:` reads naturally for envless records, `default:` reads naturally when paired with `values:`.

`--env` is **only required** when at least one selected key has a `values` map without a fallback. A fully envless config can run without `--env`. For `keyshelf run`, "selected" means a key that is reachable from the active `.env.keyshelf` (see [App mapping](#app-mapping-envkeyshelf)) — a `values`-only key the app never maps does not force `--env`.

## Templates

A `config` binding can interpolate other keys with `${path/to/key}`:

```ts
db: {
  host: "localhost",
  port: 5432,
  user: "app",
  password: secret({ value: age({ ... }) }),
  url: config({
    default: "postgres://${db/user}:${db/password}@${db/host}:${db/port}/mydb"
  })
}
```

References are resolved after group/filter selection. Cyclic references are rejected at validation time. Templates can reference both config and secret keys — referencing a secret means the rendered string is itself sensitive. Use `$${...}` to emit a literal `${...}`.

Templates are only valid inside `config(...)` bindings. Use them in `.env.keyshelf` mappings as well; see below.

## Groups and filters

Groups label keys; filters select by path prefix. Both are runtime selectors, not part of resolution semantics.

```sh
keyshelf run --group app -- node server.js          # only keys with group: 'app'
keyshelf run --group app,ci -- ...                  # union
keyshelf run --filter db,log -- ...                 # only keys whose path starts with db/ or log/
keyshelf run --group app --filter db -- ...         # intersection of both
```

When a filter excludes a key referenced by an `.env.keyshelf` template (or by another template), that env var is **skipped** with a stderr warning, not failed and not emitted as empty:

```
keyshelf: skipping DB_URL — referenced key 'db/password' was filtered out by --group
```

Same rule applies to optional secrets that don't resolve in the active env.

## App mapping (`.env.keyshelf`)

Each app declares which keys it consumes and the env var names to use:

```ini
# apps/api/.env.keyshelf
DB_HOST=db/host
DB_URL=postgres://${db/host}:${db/port}/mydb
```

- **Direct mapping:** `ENV_VAR=key/path` — emits the resolved key value.
- **Template mapping:** `ENV_VAR=...${key/path}...` — substitutes each reference and emits the composed string.

A host shell env var that is already set takes precedence over the resolved value, so you can always override anything by exporting the env var first:

```sh
DB_HOST=localhost keyshelf run --env production -- node server.js
```

Template mappings are skipped during `keyshelf import` because composite values cannot be decomposed back into individual keys.

## CLI

### `keyshelf run`

Resolve every key referenced by the local `.env.keyshelf`, inject them as env vars, and spawn a command.

```sh
keyshelf run --env dev -- npm start
keyshelf run --env production --group app -- node server.js
keyshelf run --filter db -- ./scripts/check-db.sh
keyshelf run --map ./infra/.env.keyshelf -- terraform apply
```

Resolution is **scoped to the app mapping**. The roots are the keys the mapping references — direct mappings and the `${...}` references inside template mappings — expanded transitively through `${...}` references in `config(...)` bindings. Only that reachable set is resolved and validated: a required key outside it is never resolved and can never fail the run, even if it is unseeded or has no binding for the active env. A _mapped_ required key that can't resolve (unseeded, or no binding for the active env) still fails loudly.

`--group` / `--filter` intersect with the mapped set — excluding a mapped key keeps the [skip-with-warning](#groups-and-filters) behavior rather than failing. A mapping that points at an undeclared key path still fails fast at load.

Forwards the child process exit code.

### `keyshelf ls`

List declared records with their kind, group, and active binding source.

```sh
keyshelf ls                                          # schema only, no env context
keyshelf ls --env dev                                # show which binding applies for dev
keyshelf ls --env production --reveal                # resolve through providers and print values
keyshelf ls --env dev --reveal --map ./apps/api/.env.keyshelf --format json
```

`--reveal` decrypts secrets — guard accordingly. `--format json` is intended for programmatic consumers (e.g. the GitHub Action) and requires `--reveal`, `--env`, and `--map`.

#### `keyshelf ls --check` — exhaustive validation sweep

`run` resolution is **lazy**: it only checks the keys an app mapping actually references (see [`keyshelf run`](#keyshelf-run)). That keeps unrelated runs from failing, but it also means a never-mapped required key can sit unseeded — or rot — until the day something maps it. `--check` is the deliberate counterpart: the **exhaustive sweep** that resolves _every_ declared key for an env, ignoring app mappings entirely.

```sh
keyshelf ls --check --env dev
keyshelf ls --check --env production        # sweep each env CI cares about
```

- Resolves every declared key for `--env` and **exits non-zero** if any _required_ key is unresolvable, listing each failing key and its cause (no binding for the env vs. a provider error) — never the secret value.
- A _required_ key that can't resolve fails the sweep; an _optional_ key that doesn't resolve is reported as `SKIP`, not a failure.
- Exit code `0` when everything required resolves — suitable for CI gating, one invocation per env.
- `--check` requires `--env` and can't be combined with `--reveal` or `--format json`. `--group` / `--filter` narrow the swept set when you want to gate a subset.

The rule of thumb: **`run` = lazy** (only what an app needs, right now); **`ls --check` = the exhaustive sweep** (everything declared, deliberately, in CI).

### `keyshelf set`

Write a secret value through its bound provider. Does **not** edit `keyshelf.config.ts` — config keys are hand-edited.

```sh
keyshelf set --env production db/password --value "s3cret"
keyshelf set --env production db/password                 # interactive prompt on TTY
echo "s3cret" | keyshelf set --env production db/password # from pipe
keyshelf set github/token --value "..."                   # envless secret
```

The provider used is the one bound at `values[env]`, or the record's `default`/`value` if no env-specific binding exists. Trying to `set` a config key is rejected — change `keyshelf.config.ts` directly.

### `keyshelf import`

Bulk-write secret values from a `.env` file by reverse-mapping env-var names through `.env.keyshelf`.

```sh
keyshelf import --env production --file .env.production
keyshelf import --env staging --group app --file .env.staging
```

Only secret keys are written. Config keys mapped in the file are skipped (with a warning) — edit `keyshelf.config.ts` to change config defaults.

## Providers

### `age({ identityFile, secretsDir })`

Local encrypted secrets using [age](https://age-encryption.org/). Each secret is one `.age` file in `secretsDir`, named after the key path (`/` mangled to `_`). The identity at `identityFile` decrypts on `run` and derives the recipient on `set`.

```ts
secret({
  default: age({ identityFile: "./keys/dev.txt", secretsDir: "./secrets" }),
  values: {
    ci: age({ identityFile: "./keys/ci.txt", secretsDir: "./secrets" })
  }
});
```

Relative paths resolve from the directory containing `keyshelf.config.ts`. Absolute paths and `~`-prefixed paths are used as-is.

Generate a new identity programmatically:

```ts
import { generateIdentity, identityToRecipient } from "keyshelf";

const identity = await generateIdentity();
const recipient = await identityToRecipient(identity);
```

### `gcp({ project })`

Google Cloud Secret Manager. Secrets are namespaced with the keyshelf project `name` so multiple keyshelf configs can share one GCP project without colliding:

- env-scoped: `keyshelf__<name>__<env>__<keyPath>`
- envless: `keyshelf__<name>__<keyPath>`

`/` in key paths is mangled to `__` (Secret Manager doesn't allow `/`).

Requires GCP credentials in the environment (`GOOGLE_APPLICATION_CREDENTIALS`, `gcloud auth`, or workload identity). Secrets are created automatically on first `keyshelf set`.

### `sops({ identityFile, secretsFile })`

SOPS-style single-file encrypted secrets. All secrets for the bound config live in one JSON document, each value encrypted with AES-256-GCM under a shared data key that is itself age-encrypted. Tamper-detected via HMAC.

Useful when you'd rather commit one file per env than a directory full of `.age` blobs.

## What to commit

| Path                    | Commit? | Notes                                                  |
| ----------------------- | ------- | ------------------------------------------------------ |
| `keyshelf.config.ts`    | Yes     | Schema, defaults, and provider bindings                |
| `apps/*/​.env.keyshelf` | Yes     | App-level key mappings, no secret values               |
| `secrets/*.age`         | Depends | Encrypted; safe to commit if your threat model allows  |
| `secrets/*.json` (sops) | Depends | Encrypted; safe to commit if your threat model allows  |
| `keys/*.txt`            | No      | Age identity (private key) files — add to `.gitignore` |

## Programmatic API

`keyshelf/config` is for _user-authored_ configs. The package root is for _tooling that consumes them_ (e.g. the GitHub Action):

```ts
import { loadConfig, resolveWithStatus, validate, renderAppMapping } from "keyshelf";
import { ProviderRegistry, AgeProvider } from "keyshelf";

const loaded = await loadConfig(process.cwd());
const registry = new ProviderRegistry();
registry.register(new AgeProvider());

const result = await validate({
  config: loaded.config,
  envName: "production",
  rootDir: loaded.rootDir,
  registry
});
if (result.topLevelErrors.length || result.keyErrors.length) throw new Error("invalid config");

const resolution = await resolveWithStatus({
  config: loaded.config,
  envName: "production",
  rootDir: loaded.rootDir,
  registry
});

const rendered = renderAppMapping(loaded.appMapping, resolution);
```

## Editor setup

`keyshelf.config.ts` is a regular TypeScript module. Type inference from `defineConfig` autocompletes `envs`, `groups`, and `values` keys; no editor configuration is needed.

## Migrating from v4

In most cases, upgrading is not a migration — v5 accepts v4-style `keyshelf.yaml` + `.keyshelf/<env>.yaml` as a runtime config format. Bump the `keyshelf` version and your existing YAML keeps working.

`@keyshelf/migrate` covers the two cases that aren't automatic:

```sh
npx @keyshelf/migrate yaml-to-typescript   # opt-in: convert YAML to keyshelf.config.ts
npx @keyshelf/migrate project-name         # opt-in: re-namespace pre-v4.6 GCP secret IDs under name:
```

See the [migration guide](https://github.com/pantoninho/keyshelf/blob/main/docs/migrating-from-v4.md) for the full walk-through.

## Development

```sh
npm install
npm test           # vitest
npm run dev        # run CLI via tsx
npm run build      # tsup
npm run typecheck  # tsc --noEmit
```

## License

MIT
