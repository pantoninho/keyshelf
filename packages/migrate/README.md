# @keyshelf/migrate

One-shot migrator from keyshelf v4 YAML files to the v5 `keyshelf.config.ts` format.

## Run

From the repository root that contains `keyshelf.yaml`:

```bash
npx @keyshelf/migrate
```

By default the migrator writes `keyshelf.config.ts` and refuses to overwrite an existing file.

```bash
npx @keyshelf/migrate --dry-run
npx @keyshelf/migrate --out ./keyshelf.config.ts --force
npx @keyshelf/migrate --accept-renamed-name
```

Use `--accept-renamed-name` when a v4 `name` contains underscores. v5 names are lowercase kebab-case, so `my_app` becomes `my-app`.

## What It Reads

- `keyshelf.yaml`
- `.keyshelf/*.yaml`
- `.env.keyshelf`, when present at the repository root

The generated config keeps `.env.keyshelf` as a separate file. v5 still reads app mappings from `.env.keyshelf`.

## Review After Migration

- Confirm the generated `name` is the intended v5 project name.
- Fill in `groups: []` if you want to use v5 group filters.
- Rebind or copy secret values as needed. The report prints `keyshelf set` commands for each migrated secret binding.
- Review provider paths such as `identityFile`, `secretsDir`, and `secretsFile`.
- Run the v5 CLI against the generated config before deleting v4 YAML files.
