# keyshelf-action

GitHub Action that resolves [keyshelf](https://github.com/pantoninho/keyshelf)-managed config and secrets into `$GITHUB_ENV`, automatically masking secret-backed values.

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
| `env`               | no       | Environment name. Required only when at least one selected key has env-specific `values` without a fallback.                                                                |
| `map`               | yes      | Path to a `.env.keyshelf` mapping file. Multiple files supported, one per line.                                                                                             |
| `identity`          | no       | Raw identity material (e.g. an age private key). Written to every unique `age()` `identityFile` path in the config with mode `0600`. Pass via `secrets.*`; never hard-code. |
| `working-directory` | no       | Directory containing `keyshelf.config.ts`. Defaults to the repo root.                                                                                                       |
| `groups`            | no       | Comma- or newline-separated groups to include. Mapping entries that reference filtered-out keys are skipped with a workflow warning.                                        |
| `filters`           | no       | Comma- or newline-separated key-path prefixes to include. Mapping entries that reference filtered-out keys are skipped with a workflow warning.                             |

## Provider notes

- **`age` / `sops`**: pass the identity material via `identity:`. The action reads the destination path from provider bindings in `keyshelf.config.ts`.
- **`gcp`**: configure GCP credentials with [`google-github-actions/auth`](https://github.com/google-github-actions/auth) before this action runs. `identity` is not used; pass `gcp` mappings via `map:` as usual.
- **Multi-identity age configs**: the identity writer writes the same `identity:` value to every unique `age()` `identityFile` path in the config.

## Masking

For each resolved variable, if the underlying key is secret-backed, the action emits `::add-mask::<value>` before appending to `$GITHUB_ENV`. Template mappings (`${path/to/key}` interpolation) are masked if **any** referenced key is a secret — masking a non-secret is harmless; missing a secret is a leak.

## Runtime benchmark

The action installs `jiti` and `zod` at runtime. Measure cold and warm install time with:

```sh
npm run benchmark:runtime-deps -w @keyshelf/action
```
