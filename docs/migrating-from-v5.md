# Migrating from v5

keyshelf@6 is a ground-up redesign, not an incremental upgrade. The config
format, the key model, and the provider set all changed, and there is **no
automated migrator** — the old `@keyshelf/migrate` package was retired in the
cutover. Migration is manual.

If you are starting fresh, ignore this page and read
[the build reference](./reference.md). This guide is only for people who knew v5
and want to know how the old concepts map onto the new model.

## How the model changed

| v5                                                        | v6                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `keyshelf.config.ts` / `keyshelf.yaml` (`defineConfig`)   | `.keyshelf/config.yaml` (project + providers) — no TypeScript, no code                     |
| One config declaring every key                            | One **shelf** per schema: `.keyshelf/{shelf}/schema.yaml`                                  |
| `envs` list                                               | One file per environment: `.keyshelf/{shelf}/{stage}.yaml`, addressed as `{shelf}/{stage}` |
| `config(...)` / `secret(...)` records                     | Keys declared in `schema.yaml`; plaintext-vs-`!secret` chosen per environment              |
| `value` / `default`                                       | A schema default (a bare value in `schema.yaml`)                                           |
| per-env `values`                                          | Per-environment overrides in `{stage}.yaml`                                                |
| Object-literal **namespaces** flattening to `/`-paths     | Flat keys matching `^[A-Z_][A-Z0-9_]*$` (UPPER_SNAKE)                                      |
| `.env.keyshelf` (`ENV_VAR=key/path`)                      | Gone — keys are env-var names already (see [Keys](#keys))                                  |
| Providers: `age`, `aws-sm`, `gcp-sm`, `sops`, `plaintext` | Adapters: `gcp`, `sops` (plus the self-contained `fake` for examples/tests)                |

Identity in v6 is **filesystem-derived**: the shelf is its directory name, the
environment is its filename, the schema is the shelf's `schema.yaml`. There are
no `name:` or `schema:` fields anywhere.

## Side by side

A minimal v5 config:

```ts
// keyshelf.config.ts
export default defineConfig({
  name: "myapp",
  envs: ["dev"],
  keys: {
    server: {
      LOG_LEVEL: config({ default: "info", values: { dev: "debug" } }),
      DB_PASSWORD: secret()
    }
  }
});
```

becomes, in v6, three files under `.keyshelf/`:

```yaml
# .keyshelf/config.yaml — project + project-global providers
project: myapp
providers:
  local:
    adapter: sops
```

```text
# .keyshelf/app/schema.yaml — the shelf's closed contract (presence only)
keys:
  LOG_LEVEL: info # config default — overridable
  DB_PASSWORD: !required # must be supplied by every environment
```

```text
# .keyshelf/app/dev.yaml — one environment implementing the schema
provider: local
keys:
  LOG_LEVEL: debug # overrides the schema default
  DB_PASSWORD: !secret # value lives in the store, not this file
```

The v5 `server` namespace is gone: its keys become flat keys on the `app` shelf.
The schema governs **presence only** (`default` / `!required` / `!optional`);
whether a key is plaintext or `!secret` is now an environment's call, so the same
key can be config in one environment and a secret in another.

## Keys

v5 keys were nested object paths flattened to `/`-separated strings with
arbitrary casing. v6 keys are flat and must be valid environment-variable
identifiers: `^[A-Z_][A-Z0-9_]*$` (UPPER_SNAKE). Flatten any nested namespace by
hand — `server/db/password` → `DB_PASSWORD`.

Because keys are already env-var names, v6 has no separate mapping file. `keyshelf run {shelf}/{stage} -- <cmd>` resolves the environment to a flat
`string → string` map (schema defaults overlaid with environment values, every
`!secret` resolved through the provider), overlays that onto the inherited
process environment, and execs the command — so a key named `DB_PASSWORD` is
injected as the `DB_PASSWORD` env var verbatim. This subsumes v5's
`.env.keyshelf` (`ENV_VAR=key/path`) indirection. Precedence, highest to lowest:
explicit `--set KEY=VALUE` → keyshelf's resolved value → inherited ambient env
(only for keys keyshelf does not manage).

## What's dropped in v6

v6 is intentionally the smaller tool. These v5 features have no v6 equivalent:

- **`aws-sm` provider** — no v6 adapter. Use `gcp` or `sops`.
- **`age` provider** — no standalone adapter. Use `sops`, which can be backed by
  age keys.
- **`plaintext` provider** — no longer a provider; plaintext config values live
  directly in the environment file (a key is just not marked `!secret`).
- **Template interpolation** (`${path/to/key}`) — no v6 equivalent; supply the
  full value.
- **`groups` / `--group` filtering** — no v6 equivalent. Use shelves to separate
  concerns instead.
- **Nested key namespaces** — flatten to UPPER_SNAKE keys.

## Re-seeding secrets

The gcp secret-naming convention gained a `shelf` component:
`keyshelf__{project}__{env}__{key}` (v5) →
`keyshelf__{project}__{shelf}__{stage}__{key}` (v6). A v6 name never collides with
or auto-resolves a v5 one, so existing gcp (and sops) secrets must be re-seeded
under the new names with `keyshelf set <KEY> <shelf>/<stage> --secret` (value on
stdin). There is no automated migrator.
</content>
</invoke>
