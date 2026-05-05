# Migrating from v4 without a `name`

The `name:` field was introduced in v4.6 to namespace GCP secret IDs. v5 requires it, both for `keyshelf.config.ts` and for v4-style YAML configs at runtime. If your `keyshelf.yaml` has no `name:`, you'll see:

```
keyshelf.yaml requires a top-level "name" string
```

The runtime refuses to invent a name because that name becomes the namespace for your GCP secret IDs and your v5 project identity — guessing wrong would silently fork your secret store. Pick one yourself, add it to `keyshelf.yaml`, then carry on.

This guide covers the two cases: projects that don't use GCP, and projects that do.

## 1. Pick a name

The name must match `/^[A-Za-z0-9_-]+$/` (letters, digits, `-`, `_`). Anything that was a valid v4 name is still a valid v5 name — no rename required.

Add it at the top of `keyshelf.yaml`:

```yaml
name: my-app
keys:
  # ...your existing keys...
```

Don't change anything else yet.

## 2a. No GCP bindings — you're done

If none of your secrets use `!gcp`, adding `name:` is the entire migration. The v5 CLI accepts your existing YAML as-is. Verify:

```sh
keyshelf ls --env <env>
```

If you'd rather author in TypeScript, see the optional converter in [`migrating-from-v4.md`](./migrating-from-v4.md#optional-switch-to-typescript).

## 2b. GCP bindings — re-namespace the secret IDs

Adding a `name` changes how v5 addresses GCP secrets. v5 secret IDs are built as:

```
keyshelf__<name>__<env>__<key/path with / -> __>
```

Pre-4.6 secrets in your project were written without the `<name>` segment:

```
keyshelf__<env>__<key/path with / -> __>
```

The `project-name` subcommand reads each legacy ID, copies the value to the new namespaced ID, and reports each row. It does not touch your config file — only remote secret stores.

### Dry-run first

```sh
npx @keyshelf/migrate project-name --dry-run
```

Each row prints one of these statuses:

| Status             | Meaning                                                                      |
| ------------------ | ---------------------------------------------------------------------------- |
| `migrated`         | Will copy legacy → new. With `--dry-run`, no write happens.                  |
| `already-migrated` | New secret already exists and matches the legacy value. No action needed.    |
| `no-legacy`        | No legacy secret found at that ID. Probably already cleaned up, or unbound.  |
| `value-mismatch`   | New secret exists with a **different** value. The migrator refuses to write. |
| `deleted-legacy`   | Only with `--delete-legacy` (and not `--dry-run`).                           |

`value-mismatch` is the one to investigate. It usually means someone already created the namespaced secret manually with a different value, or you ran a partial migration before. Resolve it (delete one, copy the right value over) before re-running.

### Run for real

Once the dry-run is clean:

```sh
npx @keyshelf/migrate project-name
```

This writes the new namespaced secrets. Legacy secrets are kept by default.

### Optional: clean up legacy secrets

After verifying v5 reads the new secrets correctly (`keyshelf ls --env <env>`), you can delete the legacy un-namespaced secrets in one shot:

```sh
npx @keyshelf/migrate project-name --delete-legacy
```

Or delete them manually in the GCP console once you're confident nothing else reads them.

## 3. Verify

Independent of which path you took:

```sh
keyshelf ls --env <env>          # all keys resolve
keyshelf get --env <env> <path>  # spot-check a secret value
```

## Authentication note (GCP only)

The GCP step uses application-default credentials. If you see a `GcpAuthError`, run:

```sh
gcloud auth application-default login
```

and re-run the migrator. Legacy secrets are kept in place by default, so it's safe to retry.
