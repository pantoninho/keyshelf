# Migrating from keyshelf v4

v5 is a clean rewrite. Configs are TypeScript, every key is a self-contained record, and `set` no longer touches the config file. There is no in-place upgrade — generate a starter config with the migrator, then review.

## Run the migrator

From the repo root that contains your v4 `keyshelf.yaml`:

```sh
npx @keyshelf/migrate
```

This reads `keyshelf.yaml`, every `.keyshelf/<env>.yaml`, and the root `.env.keyshelf` (if present), and writes a starter `keyshelf.config.ts`. The v4 YAML files are left in place. App-level `.env.keyshelf` mappings keep working as-is.

Useful flags:

```sh
npx @keyshelf/migrate --dry-run                 # print the generated config to stdout
npx @keyshelf/migrate --out ./keyshelf.config.ts --force
npx @keyshelf/migrate --accept-renamed-name     # if your v4 name has underscores
```

## What changed

### Config file

| v4                                                     | v5                                                       |
| ------------------------------------------------------ | -------------------------------------------------------- |
| `keyshelf.yaml` + `.keyshelf/<env>.yaml` (one per env) | One `keyshelf.config.ts`                                 |
| `default-provider:` block per env file                 | Provider binding lives on each `secret(...)` record      |
| `!secret`, `!age`, `!gcp`, `!sops` YAML tags           | `secret(...)`, `age(...)`, `gcp(...)`, `sops(...)` calls |
| Plaintext values in env files override schema defaults | `values: { <env>: ... }` on the record itself            |
| `name:` introduced in v4.6 to namespace GCP secrets    | `name:` is required and validated as `lower-kebab-case`  |

Every key's full story is now local to its declaration. There are no env-file-level overrides — to override a value per env, set `values` on the record:

```ts
db: {
  host: config({
    default: "localhost",
    values: { production: "prod-db.internal" }
  });
}
```

### `keyshelf set`

v4: `set` could write a plaintext value into `.keyshelf/<env>.yaml` _or_ encrypt through a provider. The CLI picked based on `--provider`.

v5: `set` only writes to providers. Config keys are hand-edited in `keyshelf.config.ts`. The provider used is the one bound on the record (`values[env]` or `default`/`value`); there is no `--provider` flag.

```sh
# v4
keyshelf set --env production --provider age db/password --value "s3cret"

# v5
keyshelf set --env production db/password --value "s3cret"
```

If you used `set` to update plaintext config values in v4, edit `keyshelf.config.ts` directly in v5.

### `--env` is optional

Required only when at least one selected key has a `values` map without a fallback. A fully envless config (e.g. only shared CI tokens) runs without `--env`.

### Groups and filters

v5 introduces two new selectors. Both live on the CLI; nothing in `.env.keyshelf` changes.

- `--group <name[,name...]>` — only keys whose `group:` is in the set
- `--filter <prefix[,prefix...]>` — only keys whose path starts with one of the prefixes

When a filter excludes a key referenced by an `.env.keyshelf` template, that env var is skipped with a stderr warning, not failed and not emitted as empty. Same rule for optional unresolved keys.

### Editor setup

v4 needed YAML custom-tag configuration to silence `unknown tag !secret` warnings. v5 doesn't — `keyshelf.config.ts` is a normal TypeScript module. You can delete the `yaml.customTags` and `yamllint custom-tags` entries from your editor config.

## Review checklist after running the migrator

1. **`name`** — confirm the generated value. v4 names with underscores are converted to kebab-case (`my_app` → `my-app`) only with `--accept-renamed-name`.
2. **`groups: []`** — placeholder. Add group names if you want `--group` filtering, then assign `group:` on each record.
3. **Provider paths** — `identityFile`, `secretsDir`, `secretsFile` are copied from v4 verbatim. They must resolve from the directory containing `keyshelf.config.ts`.
4. **Secrets are not migrated automatically.** The migrator prints a list of `keyshelf set` commands at the end of its run; copy those out and re-bind each secret with the value from your old store. (Drop any `--provider <name>` flag — v5 picks the provider from the record's binding.)
5. **`.env.keyshelf` references** — load-time validation rejects references to keys that don't exist in the new config. Run `keyshelf ls` once to confirm.

## Best-effort caveats

The migrator is best-effort, not exact. Known limitations:

- Per-key provider overrides spread across multiple v4 env files collapse into one `secret(...)` declaration. If a single key was bound to providers with conflicting options, the migrator picks one and reports the rest in the migration log.
- Multi-mapping `.env.keyshelf` files in subdirectories aren't relocated — they keep working from their existing paths.
- Comments in v4 YAML are not preserved.

When in doubt, run `keyshelf ls --env <env>` against the migrated config and compare to `keyshelf ls --env <env>` on the old install before deleting v4 YAML.
