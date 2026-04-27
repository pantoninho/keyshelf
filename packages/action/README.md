# keyshelf-action

GitHub Action that resolves [keyshelf](https://github.com/pantoninho/keyshelf)-managed config and secrets into `$GITHUB_ENV`, automatically masking values whose underlying schema key is `!secret`.

## Usage

```yaml
- uses: pantoninho/keyshelf/packages/action@keyshelf-action-v0.2.0
  with:
    env: staging
    identity: ${{ secrets.KEYSHELF_STAGING_IDENTITY }}
    map: infra/.env.keyshelf
```

After this step, every variable declared in `infra/.env.keyshelf` is set in the workflow environment for subsequent steps. Values from `!secret` keys are passed through `::add-mask::` before being exported.

## Inputs

| Name                | Required | Description                                                                                                                                                      |
| ------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `env`               | yes      | Environment name (matches `.keyshelf/<env>.yaml`).                                                                                                               |
| `map`               | yes      | Path to a `.env.keyshelf` mapping file. Multiple files supported, one per line.                                                                                  |
| `identity`          | no       | Raw identity material (e.g. an age private key). Written to the path declared in `.keyshelf/<env>.yaml` with mode `0600`. Pass via `secrets.*`; never hard-code. |
| `working-directory` | no       | Directory containing `keyshelf.yaml` (defaults to the repo root).                                                                                                |

## Provider notes

- **`age` / `sops`**: pass the identity material via `identity:`. The action reads the destination path from `.keyshelf/<env>.yaml`.
- **`gcp`**: configure GCP credentials with [`google-github-actions/auth`](https://github.com/google-github-actions/auth) before this action runs. `identity` is not used; pass `gcp` mappings via `map:` as usual.

## Masking

For each resolved variable, if the underlying schema key is `!secret`, the action emits `::add-mask::<value>` before appending to `$GITHUB_ENV`. Template mappings (`${path/to/key}` interpolation) are masked if **any** referenced key is a secret — masking a non-secret is harmless; missing a secret is a leak.
