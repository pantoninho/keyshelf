# Migrating from keyshelf v4

In v5, your existing `keyshelf.yaml` + `.keyshelf/<env>.yaml` files are still a valid runtime format — the v5 CLI parses them into the same internal shape as `keyshelf.config.ts`. For most projects, **upgrading is no migration at all**: bump the `keyshelf` version, run the CLI, and your YAML keeps working.

The `@keyshelf/migrate` package covers the two cases that aren't automatic:

- You want to switch authoring formats from YAML to TypeScript (autocomplete on key paths, IDE help on provider options).
- You're using GCP secrets that were written before v4.6 added a `name:` field, and you want their secret IDs re-namespaced under the new `name`.

If neither applies, you can stop reading here. Run `keyshelf ls --env <env>` against your existing config and confirm everything resolves.

## What changed at runtime

| v4                                                     | v5                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `keyshelf.yaml` + `.keyshelf/<env>.yaml`               | Same files still work, **or** a single `keyshelf.config.ts`                           |
| `default-provider:` block per env file                 | YAML form unchanged; TS form binds providers per `secret(...)` record                 |
| `!secret`, `!age`, `!gcp`, `!sops` YAML tags           | Still valid in YAML; TS uses `secret(...)`, `age(...)`, `gcp(...)`, `sops(...)` calls |
| Plaintext values in env files override schema defaults | YAML form unchanged; TS form expresses the same thing as `values: { <env>: ... }`     |
| `name:` introduced in v4.6 to namespace GCP secrets    | `name:` is required (`/^[A-Za-z0-9_-]+$/`) — same rule the v4 loader applied          |

### `keyshelf set`

v4: `set` could write a plaintext value into `.keyshelf/<env>.yaml` _or_ encrypt through a provider. The CLI picked based on `--provider`.

v5: `set` only writes to providers. Config keys are hand-edited. The provider used is the one bound on the record (the `default-provider` for the env in YAML, or `values[env]` / `default` in TS); there is no `--provider` flag.

```sh
# v4
keyshelf set --env production --provider age db/password --value "s3cret"

# v5
keyshelf set --env production db/password --value "s3cret"
```

If you used `set` to update plaintext config values in v4, edit the YAML file (or `keyshelf.config.ts`) directly in v5.

### `--env` is optional

Required only when at least one selected key has a `values` map without a fallback. A fully envless config (e.g. only shared CI tokens) runs without `--env`.

### Groups and filters

v5 introduces two new selectors. Both live on the CLI; nothing in `.env.keyshelf` changes.

- `--group <name[,name...]>` — only keys whose `group:` is in the set
- `--filter <prefix[,prefix...]>` — only keys whose path starts with one of the prefixes

When a filter excludes a key referenced by an `.env.keyshelf` template, that env var is skipped with a stderr warning, not failed and not emitted as empty. Same rule for optional unresolved keys.

Group filtering is only available in the TypeScript config format — YAML configs have no `groups:` field.

## Optional: switch to TypeScript

If you want the IDE help, run the converter from the repo root that contains your v4 `keyshelf.yaml`:

```sh
npx @keyshelf/migrate yaml-to-typescript                 # writes keyshelf.config.ts
npx @keyshelf/migrate yaml-to-typescript --dry-run       # print to stdout instead
npx @keyshelf/migrate yaml-to-typescript --out ./keyshelf.config.ts --force
```

The converter reads `keyshelf.yaml`, every `.keyshelf/<env>.yaml`, and the root `.env.keyshelf` (if present). The v4 YAML files are left in place. App-level `.env.keyshelf` mappings keep working as-is.

After conversion, review:

1. **`groups: []`** — placeholder. Add group names if you want `--group` filtering, then assign `group:` on each record.
2. **Provider paths** — `identityFile`, `secretsDir`, `secretsFile` are copied verbatim. They must resolve from the directory containing `keyshelf.config.ts`.
3. **`.env.keyshelf` references** — load-time validation rejects references to keys that don't exist. Run `keyshelf ls` once to confirm.

Once the new config resolves correctly (`keyshelf ls --env <env>`), delete `keyshelf.yaml` and `.keyshelf/`.

### Editor setup

v4 needed YAML custom-tag configuration to silence `unknown tag !secret` warnings. After switching to TypeScript, you can delete the `yaml.customTags` and `yamllint custom-tags` entries from your editor config.

## Optional: re-namespace GCP secret IDs

If your project uses GCP and was created before v4.6 (when `name:` was added), your stored secret IDs look like `keyshelf__<env>__<key>` instead of the v5 form `keyshelf__<name>__<env>__<key>`. The `project-name` subcommand copies the legacy IDs to the namespaced ones:

```sh
npx @keyshelf/migrate project-name --dry-run
npx @keyshelf/migrate project-name
npx @keyshelf/migrate project-name --delete-legacy
```

The dry run reports each row with one of these statuses:

| Status             | Meaning                                                                      |
| ------------------ | ---------------------------------------------------------------------------- |
| `migrated`         | Will copy legacy → new. With `--dry-run`, no write happens.                  |
| `already-migrated` | New secret already exists and matches the legacy value. No action needed.    |
| `no-legacy`        | No legacy secret found at that ID. Probably already cleaned up, or unbound.  |
| `value-mismatch`   | New secret exists with a **different** value. The migrator refuses to write. |
| `deleted-legacy`   | Only with `--delete-legacy` (and not `--dry-run`).                           |

`value-mismatch` is the one to investigate. It usually means someone created the namespaced secret manually with a different value, or you ran a partial migration before. Resolve it (delete one, copy the right value over) before re-running.

For `age` and `sops`, the subcommand is a no-op — those providers store secrets co-located with the project and have no remote namespace to migrate.

See [`migrating-without-v4-name.md`](./migrating-without-v4-name.md) for the case where your v4 config never had a `name:` at all.

## Authentication note (GCP only)

The GCP step uses application-default credentials. If you see a `GcpAuthError`, run:

```sh
gcloud auth application-default login
```

and re-run the migrator. Legacy secrets are kept in place by default, so it's safe to retry.
