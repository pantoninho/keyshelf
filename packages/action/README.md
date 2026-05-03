# keyshelf-action

GitHub Action that resolves [keyshelf](https://github.com/pantoninho/keyshelf)-managed config and secrets into `$GITHUB_ENV`, automatically masking secret-backed values.

Requires a v5 `keyshelf.config.ts` at the repo root (or under `working-directory`). v4 YAML configs are not supported — run [`@keyshelf/migrate`](../migrate) first.

## Usage

```yaml
- uses: pantoninho/keyshelf/packages/action@keyshelf-action-v1.0.0
  with:
    env: staging
    groups: app
    filters: db,github
    identity: ${{ secrets.KEYSHELF_STAGING_IDENTITY }}
    map: infra/.env.keyshelf
```

After this step, every variable declared in `infra/.env.keyshelf` is set in the workflow environment for subsequent steps. Secret values are passed through `::add-mask::` before being exported.

## Inputs

| Name                | Required | Description                                                                                                                                                                 |
| ------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `env`               | no       | Environment name. Required only when at least one selected key has env-specific `values` without a fallback. A fully envless config can run without it.                     |
| `map`               | yes      | Path to a `.env.keyshelf` mapping file. Multiple files supported, one per line.                                                                                             |
| `identity`          | no       | Raw identity material (e.g. an age private key). Written to every unique `age()` `identityFile` path in the config with mode `0600`. Pass via `secrets.*`; never hard-code. |
| `working-directory` | no       | Directory containing `keyshelf.config.ts`. Defaults to the repo root.                                                                                                       |
| `groups`            | no       | Comma- or newline-separated groups to include. Mapping entries that reference filtered-out keys are skipped with a workflow warning.                                        |
| `filters`           | no       | Comma- or newline-separated key-path prefixes to include. Mapping entries that reference filtered-out keys are skipped with a workflow warning.                             |

### Filtering

`groups` and `filters` are independent — pass either or both. With both set, a key must match _both_ to be included.

```yaml
# Only secrets used by CI; other groups are skipped
- uses: pantoninho/keyshelf/packages/action@keyshelf-action-v1.0.0
  with:
    groups: ci
    map: .env.keyshelf

# Only db/* keys, regardless of group
- uses: pantoninho/keyshelf/packages/action@keyshelf-action-v1.0.0
  with:
    env: production
    filters: db
    identity: ${{ secrets.KEYSHELF_PROD_IDENTITY }}
    map: apps/api/.env.keyshelf
```

When a `.env.keyshelf` template (e.g. `DB_URL=postgres://${db/host}:${db/password}@...`) references a key that's been filtered out, the entire env var is **skipped** with a `::warning::` notice — never emitted as empty, never failed silently. Same rule applies to optional secrets that don't resolve in the active env.

### `env` is now optional

In v5, `--env` is only required when at least one selected key has a `values` map without a fallback. Configs whose secrets all live in shared/envless bindings (e.g. CI tokens) work without it:

```yaml
- uses: pantoninho/keyshelf/packages/action@keyshelf-action-v1.0.0
  with:
    groups: ci
    identity: ${{ secrets.KEYSHELF_CI_IDENTITY }}
    map: .env.keyshelf
```

If you do pass `env`, it must match a name from the config's top-level `envs: [...]` list.

## Provider notes

- **`age` / `sops`**: pass the identity material via `identity:`. The action reads the destination path from each `age()` provider binding in `keyshelf.config.ts`.
- **`gcp`**: configure GCP credentials with [`google-github-actions/auth`](https://github.com/google-github-actions/auth) before this action runs. `identity` is not used; pass `gcp` mappings via `map:` as usual.
- **Multi-identity age configs**: the identity writer writes the same `identity:` value to every unique `age()` `identityFile` path in the config. Configs that legitimately need multiple distinct age keys are not supported yet.

## Masking

For each resolved variable, if the underlying key is secret-backed, the action emits `::add-mask::<value>` before appending to `$GITHUB_ENV`. Template mappings (`${path/to/key}` interpolation) are masked if **any** referenced key is a secret — masking a non-secret is harmless; missing a secret is a leak.

## Runtime benchmark

The action installs `jiti` and `zod` at runtime (they ship as CJS with dynamic `require()` and can't be bundled into the action's ESM build). Measure cold and warm install time with:

```sh
npm run benchmark:runtime-deps -w @keyshelf/action
```
