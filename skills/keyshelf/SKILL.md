---
name: keyshelf
description: Use when working in a repository that contains a `keyshelf.config.ts` (or v4 `keyshelf.yaml`) or an `.env.keyshelf` file, or when the user mentions keyshelf, `keyshelf run/set/import/up/ls/cp`, or asks to add, rename, read, or inject a config value or secret in such a repo. Keyshelf is a CLI that manages config and secrets for monorepos via a single declarative TypeScript file; the rules below are easy to misapply from intuition alone.
---

# Keyshelf

Keyshelf manages config and secrets for a repo via **one** TypeScript file (`keyshelf.config.ts` at the repo root) that declares every key. Each app then has a small `.env.keyshelf` mapping `ENV_VAR=key/path`. The CLI resolves keys (decrypting secrets through their bound providers) and exposes them as env vars to a child process.

Before doing anything in a keyshelf repo, read `keyshelf.config.ts` and the relevant `.env.keyshelf`. Almost every mistake below comes from skipping that step and guessing.

## Mental model

- **One config file.** `keyshelf.config.ts` at the repo root is the only place keys are declared. No cross-file overrides.
- **Records vs. namespaces.** A _record_ is a leaf — a `config(...)` call, a `secret(...)` call, or a bare scalar (string/number/boolean). An _object literal_ is a _namespace_ — it flattens into `/`-joined paths. **Object literals are never records, even if their fields look like record options.** See "namespace trap" below.
- **Two kinds of records:** `config(...)` for plaintext, `secret(...)` for values that live in a provider (age/gcp/aws/sops). Secrets do not store plaintext — every binding on a `secret` must be a provider call.
- **Per-env overrides via `values`.** Each record's binding can be a single default (`value` or `default`) plus an optional per-env `values` map. The two `value`/`default` names are aliases for legibility — use `value` for envless records, `default` when paired with `values`. Setting both on one record is an error.
- **Apps consume keys via `.env.keyshelf`.** Each app dir has an `.env.keyshelf` mapping `ENV_VAR=key/path` (or templates that compose multiple keys). `keyshelf run` reads this file from the CWD.

A path is either a leaf or a namespace, never both: `foo: 'bar'` and `foo: { x: 'y' }` at the same level is a duplicate-path error.

## Commands (when to use what)

| Goal                                                      | Command                                                               |
| --------------------------------------------------------- | --------------------------------------------------------------------- |
| Run an app with secrets injected as env vars              | `keyshelf run --env <env> -- <cmd>`                                   |
| Write a single secret value                               | `keyshelf set --env <env> <key/path> --value '<value>'`               |
| Bulk-write secrets from a `.env` file                     | `keyshelf import --env <env> --file <.env>`                           |
| Reconcile provider storage with config (renames, deletes) | `keyshelf up [--plan] [--yes]`                                        |
| List declared keys / inspect resolution                   | `keyshelf ls [--env <env>] [--reveal] [--map <file>] [--format json]` |
| Copy a single key value to the clipboard                  | `keyshelf cp [--env <env>] <key/path>`                                |

Notes:

- `--env` is **only required** when at least one selected key has a `values` map without a fallback. A fully envless config can run without it.
- `keyshelf set` and `keyshelf import` only write **secrets**. They never edit `keyshelf.config.ts`. Trying to `set` a config key is rejected — see "changing a config value" below.
- `keyshelf run` and `keyshelf ls --map` are run from the **app directory** (the one containing `.env.keyshelf`), not the repo root.

## The five mistakes agents make

### 1. The namespace trap

```text
keys: {
  foo: { value: 'bar' }       // ❌ NOT a record. This declares key `foo/value` = "bar".
}
```

An object literal is **always** a namespace. To declare a leaf at `foo`, use a factory call or a bare scalar:

```text
keys: {
  foo: 'bar',                            // ✅ bare scalar — config({ value: 'bar' })
  foo: config({ value: 'bar' }),         // ✅ explicit
  foo: secret({ value: age({ ... }) }),  // ✅ secret leaf
}
```

If you see a nested object whose fields look like factory options (`{ value, values, default, group, optional }`), it is almost certainly meant to be `config(...)` or `secret(...)` and is currently wrong.

### 2. Plaintext in `secret(...)`

```text
password: secret({ value: 'hunter2' })   // ❌ rejected at validation
```

Every binding on a `secret` must be a provider factory call. Real options:

```text
password: secret({ value: age({ identityFile: './keys/dev.txt', secretsDir: './secrets' }) })  // ✅
password: secret({ value: gcp({ project: 'myproj' }) })                                        // ✅
password: secret({ value: plain('dev-stub') })                                                 // ⚠ inline only, not for real secrets
```

For non-sensitive values, use `config(...)`, not `secret(...)`.

### 3. Editing config via the CLI

`keyshelf set`, `keyshelf import`, `keyshelf up` all leave `keyshelf.config.ts` untouched. They only mutate provider storage.

- Want to change a config value (plaintext default, per-env override, template)? **Edit `keyshelf.config.ts` directly.**
- Want to change a secret's stored value? `keyshelf set --env <env> <key/path>`.
- Want to add a new key? Edit `keyshelf.config.ts`. Then if it's a secret, `keyshelf set` to populate it; then update any app's `.env.keyshelf` that needs to consume it.

### 4. Renames need `movedFrom` + `keyshelf up`

Just renaming a key in `keyshelf.config.ts` leaves the old value orphaned in provider storage. The intended flow:

1. Edit `keyshelf.config.ts`: rename the key and add `movedFrom: '<old-path>'` on the renamed record.
2. `keyshelf up --plan` to preview.
3. `keyshelf up` to apply (copies value to new path, deletes old entry).

Without `movedFrom`, `up` will not guess which orphan in storage corresponds to which new key when more than one is plausible — it refuses to apply.

### 5. Skipping `.env.keyshelf`

`keyshelf run` does not auto-inject every declared key. It injects exactly the env vars listed in the app's `.env.keyshelf`. If a key isn't appearing in the child process, the fix is almost always to add a line to `.env.keyshelf` in the app dir, not a flag.

```ini
# apps/api/.env.keyshelf
DB_HOST=db/host
DB_PASSWORD=db/password
# templates compose multiple keys into one env var:
DB_URL=postgres://${db/user}:${db/password}@${db/host}:${db/port}/mydb
```

Host env vars that are already set take precedence over keyshelf's value, so `DB_HOST=other keyshelf run -- ...` overrides.

## Validation rules worth memorizing

- Path segments must match `/^[A-Za-z][A-Za-z0-9-]*$/`. **No underscores** — they are reserved for provider id mangling. `/` is the separator. Use hyphens for multi-word segments: `feature-flags/launch-darkly/sdk-key`.
- `value` and `default` are aliases; setting both on one record errors.
- `secret({...})` must have at least one binding that resolves in the active env. Empty `secret({})` is rejected.
- Bare scalars (`'info'`, `5432`, `true`) cannot carry `group`, `optional`, `values`, or `description`. Use the factory when any of those apply.
- Templates (`${path/to/key}`) only work inside `config(...)` bindings, never inside `secret(...)`. Escape a literal `${...}` with `$${...}`.
- Template references and `.env.keyshelf` references must point to declared key paths. Cyclic templates are rejected.
- Any `group` field must be in the top-level `groups[]`. Any key in a `values` map must be in `envs[]`.

## Recipes

### Add a new secret for `production` only

1. Edit `keyshelf.config.ts`:

   ```text
   stripe: {
     'webhook-secret': secret({
       group: 'app',
       values: { production: gcp({ project: 'myproj' }) }
     })
   }
   ```

2. Populate it: `keyshelf set --env production stripe/webhook-secret --value '<value>'`
3. Map it in the consuming app: add `STRIPE_WEBHOOK_SECRET=stripe/webhook-secret` to `apps/<app>/.env.keyshelf`.

### Change a config default

Edit `keyshelf.config.ts`. Do **not** try `keyshelf set` — it only writes secrets.

### Rotate a secret value

`keyshelf set --env <env> <key/path>` — prompts on TTY, or pass `--value`, or pipe from stdin. The provider used is the one bound at `values[env]`, or the record's `default`/`value` if no env-specific binding exists.

### Rename a key

```text
// before: github: { token: secret({ value: age({...}) }) }
// after:
ci: {
  'github-token': secret({
    movedFrom: 'github/token',
    value: age({ identityFile: './keys/ci.txt', secretsDir: './secrets' })
  })
}
```

Then `keyshelf up --plan` to preview, `keyshelf up` to apply. Don't forget to update `.env.keyshelf` files referencing the old path.

### Run an app locally

```sh
cd apps/api
keyshelf run --env dev -- npm start
```

`keyshelf run` is run from the app directory because that's where `.env.keyshelf` lives.

### Inspect what a key will resolve to

```sh
keyshelf ls --env production                    # schema view — which binding applies, no decryption
keyshelf ls --env production --reveal           # decrypts secrets. ⚠ prints values to stdout.
```

## Providers

- **`age({ identityFile, secretsDir })`** — local encrypted secrets, one `.age` file per key. Identity files are private keys; never commit them. Ciphertext is usually safe to commit if your threat model allows.
- **`gcp({ project })`** — Google Secret Manager. Needs GCP creds in the env. Secret ids are namespaced with the config `name`.
- **`aws({ region?, kmsKeyId? })`** — AWS Secrets Manager. Bare `aws()` works if the SDK can resolve a region.
- **`sops({ identityFile, secretsFile })`** — SOPS-style single-file encrypted JSON.
- **`plain('literal')`** — inline literal value. For dev stubs / blank optional secrets only; the value lives in the config file. `keyshelf set` refuses to write to a `plain`-bound key.

## When in doubt

- Read `keyshelf.config.ts` and the relevant `.env.keyshelf` first.
- Run `keyshelf ls --env <env>` to see what keyshelf thinks the schema is.
- The full reference lives in `docs/spec.md` at the repo root, and worked examples in `examples/`. Prefer those over guessing.
