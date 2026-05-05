# @keyshelf/migrate

Helpers for moving keyshelf v4 projects to v5. v4 YAML configs are now valid v5 configs at runtime, so most projects do not need to migrate at all — these subcommands cover the two cases that are not automatic.

## Subcommands

### `yaml-to-typescript`

Converts `keyshelf.yaml` + `.keyshelf/*.yaml` into a single `keyshelf.config.ts`. Useful if you prefer the TypeScript authoring surface or want IDE autocomplete on key paths.

```bash
npx @keyshelf/migrate yaml-to-typescript
npx @keyshelf/migrate yaml-to-typescript --dry-run
npx @keyshelf/migrate yaml-to-typescript --out ./keyshelf.config.ts --force
```

### `project-name`

Re-namespaces remote secret stores under the v5 project name. The migration is dispatched per provider:

- `age`, `sops` — no-op (secrets are co-located with the project; there is no remote namespace to migrate).
- `gcp` — copies legacy un-namespaced GCP secret ids (e.g. `keyshelf__production__db__password`) to project-namespaced ids (`keyshelf__<name>__production__db__password`).

```bash
npx @keyshelf/migrate project-name --dry-run
npx @keyshelf/migrate project-name
npx @keyshelf/migrate project-name --delete-legacy
```

`--delete-legacy` deletes the un-namespaced secrets after copying — only run it once you have confirmed the new ids resolve correctly.

## What It Reads

- `keyshelf.yaml`
- `.keyshelf/*.yaml`
- `.env.keyshelf`, when present at the repository root

`.env.keyshelf` is preserved as a separate file by both subcommands.

## Review After `yaml-to-typescript`

- Confirm the generated `name` is the intended v5 project name.
- Fill in `groups: []` if you want to use v5 group filters.
- Review provider paths such as `identityFile`, `secretsDir`, and `secretsFile`.
- Run the v5 CLI against the generated config before deleting v4 YAML files.
