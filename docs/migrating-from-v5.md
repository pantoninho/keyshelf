# Migrating from v5

keyshelf@6 is a ground-up redesign, not an incremental upgrade. The config
format, the key model, and the provider set all changed, and there is **no
automated migrator** — the old `@keyshelf/migrate` package was retired in the
cutover. Migration is manual.

If you are starting fresh, ignore this page and read
[the build reference](./reference.md). This guide is only for people who knew v5
and want to know how the old concepts map onto the new model.

## How the model changed

| v5                                                        | v6                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `keyshelf.config.ts` / `keyshelf.yaml` (`defineConfig`)   | `.keyshelf/config.yaml` (project + providers) — no TypeScript, no code                                  |
| One config declaring every key                            | One **shelf** per schema: `.keyshelf/{shelf}/schema.yaml`                                               |
| `envs` list                                               | One file per environment: `.keyshelf/{shelf}/environments/{stage}.yaml`, addressed as `{shelf}/{stage}` |
| `config(...)` / `secret(...)` records                     | Keys declared in `schema.yaml`; plaintext-vs-`!secret` chosen per environment                           |
| `value` / `default`                                       | A schema default (a bare value in `schema.yaml`)                                                        |
| per-env `values`                                          | Per-environment overrides in `{stage}.yaml`                                                             |
| Object-literal **namespaces** flattening to `/`-paths     | Flat keys matching `^[A-Z_][A-Z0-9_]*$` (UPPER_SNAKE)                                                   |
| `.env.keyshelf` (`ENV_VAR=key/path`)                      | Gone — keys are env-var names already (see [Keys](#keys))                                               |
| Providers: `age`, `aws-sm`, `gcp-sm`, `sops`, `plaintext` | Adapters: `gcp`, `sops` (plus the self-contained `fake` for examples/tests)                             |

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
# .keyshelf/app/environments/dev.yaml — one environment implementing the schema
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

## Shared values

In v5 a single secret was often mapped into many workspaces — the same
`SUPABASE_*` keys reached backend, mobile, website, and ci; `SUNSAY_BASE_URL` and
the `backend/*` keys reached both the backend and the infra-\* deploy stacks. The
naive v6 translation re-seeds that value under every consuming shelf, leaving you
with N copies to rotate in lockstep. v6 has a better tool: a **key reference**
(`!ref`, see [ADR-0007](./adr/0007-key-references-for-shared-values.md)). Declare
the value **once** in a canonical shelf and point at it from every consumer. The
underlying principle: **the value lives where it conceptually belongs, and a
`!ref` expresses "I consume this, I don't own it."**

Migrate a shared v5 value in five steps.

### 1. Identify the shared set

List the keys that appear in more than one v5 map-file / workspace. Those are the
ones worth a reference; keys used by a single workspace just become ordinary keys
on that one shelf. Examples of shared sets:

- `SUPABASE_*` — used by backend, mobile, website, and ci.
- `SUNSAY_BASE_URL` and the `backend/*` keys — used by backend plus the infra-\*
  deploy stacks.

### 2. Choose the canonical shelf — the shelf that owns the secret's domain

The canonical shelf is wherever the value **conceptually belongs**, decided in
this order:

1. **It is already one shelf's own value, and the others merely consume it** →
   that shelf is canonical; leave the value there. `SUNSAY_BASE_URL` and
   `backend/*` are the backend's own values, so they stay in `backend` and the
   infra-\* environments reference them.
2. **It belongs to an external service/provider with no natural owner among the
   consumers** → put it in a shelf named for that service, creating a holding
   shelf if one does not exist. `SUPABASE_*` belongs to Supabase, not to backend
   or mobile, so it goes in a `supabase` shelf.
3. **Tie-break** — prefer an existing owning shelf over inventing a new one; only
   create a dedicated holding shelf when no existing shelf is the natural owner.

**Avoid a catch-all `shared` junk-drawer.** A `shared` shelf discards the
ownership signal that makes a reference meaningful — the whole point of `!ref` is
that the target shelf names who owns the value. A holding shelf (like `supabase`)
**may never be `run` directly**, and that is fine: it exists purely as the
canonical home for its keys.

### 3. Re-seed the value once under the v6 name

Declare the key in the canonical shelf's `schema.yaml`, then seed its value
**once** with `keyshelf set` (v6 shelf-qualified names never auto-resolve v5
names — see [Re-seeding secrets](#re-seeding-secrets)). Keep the canonical key
name identical to the v5 name where possible:

```
keyshelf set SUPABASE_URL          supabase/production            # plaintext, value on stdin
keyshelf set SUPABASE_SERVICE_ROLE_KEY supabase/production --secret  # secret, value on stdin
```

### 4. Author `!ref`s in the consuming shelves

In each consumer, declare the key in its `schema.yaml`, then point it at the
canonical shelf with `keyshelf set --ref`:

```
keyshelf set <KEY> <shelf>/<stage> --ref <target-shelf>[/<target-stage>] [--ref-key <target-key>]
```

`set --ref` is a pure offline file edit — it reads no value from stdin and calls
no provider. Lean on the defaults:

- **Same-name default** — `--ref <shelf>` writes `!ref { shelf }`, resolving the
  target key under the **same name**. Only pass `--ref-key` where v5 actually
  renamed the key.
- **Same-stage default** — the target resolves at the **current stage**, so the
  consumer line is identical across stages (`production` references `production`,
  `staging` references `staging`) with no `stage:` to maintain.

### Side by side: `SUPABASE_*` shared across four shelves

In v5, every workspace's map-file repeated the Supabase keys (and ci renamed the
service-role key):

```ts
// keyshelf.config.ts — the Supabase keys duplicated per workspace
export default defineConfig({
  name: "sunsay",
  envs: ["production"],
  keys: {
    backend: { SUPABASE_URL: secret(), SUPABASE_SERVICE_ROLE_KEY: secret() },
    mobile: { SUPABASE_URL: secret(), SUPABASE_SERVICE_ROLE_KEY: secret() },
    website: { SUPABASE_URL: secret(), SUPABASE_SERVICE_ROLE_KEY: secret() },
    ci: { SUPABASE_URL: secret(), SUPABASE_KEY: secret() } // ci used a different name
  }
});
```

In v6, the value lives once on a canonical `supabase` shelf and each consumer
references it. First the canonical home:

```yaml
# .keyshelf/supabase/schema.yaml — the canonical owner; never `run` directly
keys:
  SUPABASE_URL: !required
  SUPABASE_SERVICE_ROLE_KEY: !required
```

```yaml
# .keyshelf/supabase/environments/production.yaml — seeded once (step 3)
provider: local
keys:
  SUPABASE_URL: https://xyz.supabase.co # plaintext config
  SUPABASE_SERVICE_ROLE_KEY: !secret # value lives in the store

```

Then each consumer references it. `backend`, `mobile`, and `website` keep the
same key names, so they need no `--ref-key`:

```
keyshelf set SUPABASE_URL              backend/production --ref supabase
keyshelf set SUPABASE_SERVICE_ROLE_KEY backend/production --ref supabase
keyshelf set SUPABASE_URL              mobile/production  --ref supabase
keyshelf set SUPABASE_SERVICE_ROLE_KEY mobile/production  --ref supabase
keyshelf set SUPABASE_URL              website/production --ref supabase
keyshelf set SUPABASE_SERVICE_ROLE_KEY website/production --ref supabase
```

```yaml
# .keyshelf/backend/environments/production.yaml — a mapping environment; no provider needed
keys:
  SUPABASE_URL: !ref { shelf: supabase } # same name, current stage
  SUPABASE_SERVICE_ROLE_KEY: !ref { shelf: supabase } # same name, current stage
```

`ci` consumed the service-role key under a renamed key (`SUPABASE_KEY`), so it is
the one place that needs `--ref-key`:

```
keyshelf set SUPABASE_URL ci/production --ref supabase
keyshelf set SUPABASE_KEY ci/production --ref supabase --ref-key SUPABASE_SERVICE_ROLE_KEY
```

```yaml
# .keyshelf/ci/environments/production.yaml
keys:
  SUPABASE_URL: !ref { shelf: supabase } # same-name default
  SUPABASE_KEY: !ref { shelf: supabase, key: SUPABASE_SERVICE_ROLE_KEY } # renamed target
```

Each `!ref` resolves through the **target** shelf's provider, so the consumers
above are mapping environments and may omit `provider:` entirely. Rotating the
Supabase service-role key is now one `keyshelf set SUPABASE_SERVICE_ROLE_KEY
supabase/production --secret` — every consumer picks up the new value on its next
`run`.

### 5. Duplicate vs. reference

Re-seeding the same value under every shelf is simpler to read in isolation but
leaves you N copies to keep in sync — every rotation is N writes, and a missed
one is a silent drift. A `!ref` is one canonical value with cheap, offline
pointers. **Prefer references for genuinely shared secrets**; reach for a
duplicate only when two shelves coincidentally hold the same string today but own
it independently and may legitimately diverge later.
</content>
</invoke>
