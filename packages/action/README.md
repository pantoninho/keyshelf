# keyshelf-action

GitHub Action that resolves [keyshelf](https://github.com/pantoninho/keyshelf)-managed config and secrets into `$GITHUB_ENV`, automatically masking secret-backed values.

## Usage

v5 TypeScript config:

```yaml
- uses: pantoninho/keyshelf/packages/action@keyshelf-action-v0.4.0
  with:
    env: staging
    groups: app
    filters: db,github
    identity: ${{ secrets.KEYSHELF_STAGING_IDENTITY }}
    map: infra/.env.keyshelf
```

v4 YAML config:

```yaml
- uses: pantoninho/keyshelf/packages/action@keyshelf-action-v0.4.0
  with:
    env: staging
    identity: ${{ secrets.KEYSHELF_STAGING_IDENTITY }}
    map: infra/.env.keyshelf
```

After this step, every variable declared in `infra/.env.keyshelf` is set in the workflow environment for subsequent steps. Secret values are passed through `::add-mask::` before being exported.

## Inputs

| Name                | Required | Description                                                                                                                                                                                                                                       |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `env`               | no       | Environment name. Required for v4 configs; for v5 configs only required when at least one selected key has env-specific `values` without a fallback.                                                                                              |
| `map`               | yes      | Path to a `.env.keyshelf` mapping file. Multiple files supported, one per line.                                                                                                                                                                   |
| `identity`          | no       | Raw identity material (e.g. an age private key). Written to the path declared by the matching provider with mode `0600`. For v5, the same identity is written to every unique `age()` `identityFile` path. Pass via `secrets.*`; never hard-code. |
| `working-directory` | no       | Directory containing `keyshelf.config.ts` (v5) or `keyshelf.yaml` (v4), defaults to the repo root.                                                                                                                                                |
| `groups`            | no       | v5 only. Comma- or newline-separated groups to include. Mapping entries that reference filtered-out keys are skipped with a workflow warning.                                                                                                     |
| `filters`           | no       | v5 only. Comma- or newline-separated key-path prefixes to include. Mapping entries that reference filtered-out keys are skipped with a workflow warning.                                                                                          |

## Provider notes

- **`age` / `sops`**: pass the identity material via `identity:`. The action reads the destination path from `.keyshelf/<env>.yaml` for v4, or from provider bindings in `keyshelf.config.ts` for v5.
- **`gcp`**: configure GCP credentials with [`google-github-actions/auth`](https://github.com/google-github-actions/auth) before this action runs. `identity` is not used; pass `gcp` mappings via `map:` as usual.
- **v5 multi-identity age configs**: the current v5 identity writer writes the same `identity:` value to every unique `age()` `identityFile` path in the config.

## Masking

For each resolved variable, if the underlying key is secret-backed, the action emits `::add-mask::<value>` before appending to `$GITHUB_ENV`. Template mappings (`${path/to/key}` interpolation) are masked if **any** referenced key is a secret — masking a non-secret is harmless; missing a secret is a leak.

## Runtime benchmark

The v5 action installs `jiti` and `zod` at runtime when a TS config is detected. Measure cold and warm install time with:

```sh
npm run benchmark:v5-runtime-deps -w @keyshelf/action
```
