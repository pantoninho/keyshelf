# Feature: `keyshelf up` — Reconcile Config Against Storage

## Overview

Introduce a single reconcile command, `keyshelf up`, that makes the
`keyshelf.config.ts` file the sole source of truth and physically aligns
provider storage to match. Renaming a key in the config (e.g. moving
`supabase/db-password` to `databases/auth/dbPassword`) becomes "edit the
config, run `up`" — the tool detects the rename, copies bytes between
provider storage locations, and removes orphans.

## Agreed Approach

- **Storage stays path-keyed.** `age` files, GCP secret ids, and sops JSON
  keys remain derived from the key path. We preserve the "browse storage by
  eye" property and avoid introducing a lockfile.
- **`up` reconciles `desired = config` against `actual = provider.list()`.**
  Each provider gains a `list` capability so the planner can discover
  orphaned storage. Each provider also gains `copy` and `delete` so the
  planner can apply rename and removal actions.
- **Renames are inferred from orphan + shape match.** If a key disappears
  from the config and another appears with the same `kind` / provider type /
  provider params, the planner proposes a rename. Ambiguous matches require
  an explicit `movedFrom: 'old/path'` annotation on the new key.
- **Plan / apply UX, like Terraform.** `keyshelf up` prints a diff and asks
  for confirmation before mutating storage. `keyshelf up --plan` is
  read-only; `keyshelf up --yes` skips the prompt for CI.
- **No state files.** Source of truth is the config. Runtime truth is
  config + a `list` call to each provider. Git is consulted only as a
  tiebreaker for ambiguous shape matches; nothing is committed besides the
  config itself.
- **Incremental delivery.** Six PRs sliced by layer, so the destructive
  step (apply) lands in isolation and is reviewable on its own.

## Implementation Roadmap

### Phase 1: Provider `list` capability

> Parallel: yes (one PR per provider) | Sequential dependencies: none
> User-visible change: none

**Note on naming vs the existing `keyshelf ls` command.** `keyshelf ls`
already exists and is a _schema-side_ command — it lists records declared
in `keyshelf.config.ts`, optionally resolving each known `keyPath` through
its provider (`--reveal --env`). The new `provider.list()` is _storage-side_:
"what does this provider actually hold for this keyshelf project?" The two
answer different questions and stay separate. `keyshelf up --plan` is the
user-facing view of the storage-vs-schema diff; `keyshelf ls` keeps its
current scope.

#### Task 1.1: Extend the `Provider` interface

- **Description**: Add `list(ctx: ProviderListContext): Promise<StoredKey[]>`
  to the `Provider` interface. Each `StoredKey` carries `{ keyPath, envName }`
  reconstructed from the provider's storage layout. Add a `ProviderListContext`
  type that carries the bits a provider needs to scope a listing
  (`rootDir`, `config`, `keyshelfName`, optional `envName` filter).
- **Files**: `packages/cli/src/providers/types.ts`
- **Details**:
  - `StoredKey` is `{ keyPath: string; envName: string | undefined }`.
  - Listing scope is "every key this provider currently holds for this
    keyshelf project" — i.e. filtered by `keyshelfName` prefix where the
    storage layout encodes it. Env-scoped vs envless entries are both
    returned; the planner is responsible for matching them against the
    config's binding shape.
  - Document that `list` is best-effort: if a provider can't enumerate
    (e.g. credentials missing), it should throw a typed error the planner
    can render as "skipped: cannot list".
- **Commit message**: `feat(providers): add list capability to provider interface`

#### Task 1.2: Implement `list` for `age`

- **Description**: Walk `secretsDir`, parse filenames back into key paths.
- **Files**: `packages/cli/src/providers/age.ts`
- **Details**:
  - Reverse the existing `keyPathToFileName` mangling (`_` → `/`). This is
    lossy when the original key path contained `_` segments — record this
    limitation in a code comment and reject path segments containing `_`
    in the schema validator (Phase 5 cleanup; not a blocker for `list`).
  - File-per-env layout (if any) is currently flat — `envName` is
    `undefined` from age, since age storage is envless in v5.
  - Skip non-`.age` files quietly.
- **Commit message**: `feat(providers/age): implement list`

#### Task 1.3: Implement `list` for `gcp`

- **Description**: Call `client.listSecrets({ parent: projects/<project> })`,
  filter by the `keyshelf__<name>__` prefix, parse ids back into
  `(envName, keyPath)`.
- **Files**: `packages/cli/src/providers/gcp-sm.ts`
- **Details**:
  - Reuse / invert `toSecretId`. A secret id has shape
    `keyshelf__<name>__[<env>__]<path-with-/-as-__>`. Splitting on `__`
    is unambiguous because `__` is reserved as a separator (validator
    rejects `__` inside path segments — Phase 5).
  - Wrap auth errors with the existing `GcpAuthError`.
  - Page through results — `listSecrets` returns at most 25,000 by
    default but the SDK auto-paginates if you await the array form.
- **Commit message**: `feat(providers/gcp): implement list`

#### Task 1.4: Implement `list` for `sops`

- **Description**: Read the encrypted document, decrypt the data key, and
  return the entries. The keys are already path-shaped.
- **Files**: `packages/cli/src/providers/sops.ts`
- **Details**:
  - sops storage is envless in v5 (single file per project), so all
    returned entries have `envName: undefined`.
  - If the file doesn't exist, return `[]`.
  - MAC verification still runs.
- **Commit message**: `feat(providers/sops): implement list`

### Phase 2: Plan engine

> Parallel: no | Sequential dependencies: Phase 1
> User-visible change: none (engine is internal; exposed in Phase 3)

#### Task 2.1: Define the plan data model

- **Description**: Add `packages/cli/src/reconcile/plan.ts` with the action
  types the engine emits.
- **Files**: `packages/cli/src/reconcile/plan.ts` (new)
- **Details**:
  - `Action` is a tagged union: `Create`, `Rename`, `Delete`, `NoOp`,
    `Ambiguous`.
  - `Create` carries `{ keyPath, envName, providerName }` and indicates
    storage is missing — `up` doesn't materialize values, it just flags
    that `keyshelf set` is required.
  - `Rename` carries `{ from: { keyPath }, to: { keyPath }, providerName,
envBindings: EnvName[] }` so apply can iterate per binding.
  - `Delete` carries `{ keyPath, envName, providerName }` for orphans.
  - `Ambiguous` carries the candidate set and a hint: "annotate
    `movedFrom: '<old>'` on the new key to disambiguate."
- **Commit message**: `feat(reconcile): define plan action types`

#### Task 2.2: Implement the planner

- **Description**: Pure function that takes a loaded config and a map of
  provider listings, returns an `Action[]`.
- **Files**: `packages/cli/src/reconcile/planner.ts` (new),
  `packages/cli/src/reconcile/planner.test.ts` (new)
- **Details**:
  - Build `desired`: flatten the config's key tree, expand per-env bindings
    so we end up with `(keyPath, envName, providerName, providerParams)`
    tuples.
  - Build `actual`: union of every provider's `list` result, tagged with
    provider name.
  - For each `desired` tuple: if `actual` has a matching `(keyPath,
envName)` for the same provider → `NoOp`. Else → candidate `Create`.
  - For each `actual` tuple not matched: candidate orphan.
  - Match candidate creates to candidate orphans by `(providerName, kind,
providerParams, envCoverage)`. Unique match → `Rename`. Multiple
    matches → `Ambiguous`. No match → `Create` for the desired side,
    `Delete` for the orphan side.
  - `movedFrom: 'old/path'` on a desired key forces a rename match — the
    planner uses it to bypass shape matching.
- **Tests**: cover (a) clean state → all NoOps; (b) one new key → Create;
  (c) one orphan → Delete; (d) shape-unique rename → Rename; (e) two
  orphans match one new key → Ambiguous; (f) `movedFrom` resolves
  ambiguity; (g) per-env partial moves; (h) provider-param drift (same
  path, different params) → not a rename, surfaced separately.
- **Commit message**: `feat(reconcile): implement planner`

#### Task 2.3: Wire `movedFrom` into the schema

- **Description**: Accept `movedFrom?: string | string[]` on `secret(...)`
  and `config(...)` factories. Validator confirms the path is otherwise
  absent from the schema; loader passes it to the planner.
- **Files**: `packages/cli/src/config/factories.ts`,
  `packages/cli/src/config/schema.ts`,
  `packages/cli/src/config/types.ts`
- **Details**:
  - String or string array — array form covers a key that has been
    renamed multiple times before the user got around to running `up`.
  - Validator rule: every `movedFrom` entry must NOT collide with a
    declared key path in the same config.
  - Update the spec doc (`docs/spec.md`) to describe the field.
- **Commit message**: `feat(config): add movedFrom annotation for rename hints`

### Phase 3: `keyshelf up --plan` (read-only)

> Parallel: no | Sequential dependencies: Phase 2
> User-visible change: new command, read-only

#### Task 3.1: Add the `up` command skeleton

- **Description**: New `up` subcommand. With `--plan` (the only flag in
  this phase) it loads the config, calls every provider's `list`, runs
  the planner, and prints the plan. Does not mutate storage.
- **Files**: `packages/cli/src/cli/up.ts` (new),
  `packages/cli/src/cli/index.ts`
- **Details**:
  - Plan output format mirrors Terraform-style:
    ```
    Plan:
      ~ databases/auth/dbPassword     (renamed from supabase/db-password)
           move age:secrets/supabase_db-password.age
              → secrets/databases_auth_dbPassword.age
      + databases/auth/jwtSecret      (new — run `keyshelf set` to populate)
      - legacy/old-thing               (orphan; will be deleted on apply)
    ```
  - Exit code: 0 if plan is empty, 2 if plan has actions, 1 on error
    (so CI can `keyshelf up --plan` as a drift check).
  - Without any flags in this phase, behaves the same as `--plan`. Apply
    is added in Phase 4.
- **Commit message**: `feat(cli): add keyshelf up --plan command`

#### Task 3.2: Render ambiguity helpfully

- **Description**: When the plan contains `Ambiguous` actions, print the
  candidate set and the exact `movedFrom` line the user should add.
- **Files**: `packages/cli/src/cli/up.ts`,
  `packages/cli/src/reconcile/format.ts` (new)
- **Details**:
  - Suggest the `secret({ movedFrom: 'old/path', ... })` snippet inline.
  - Don't fail — `--plan` is informational. (Apply will fail loudly in
    Phase 4.)
- **Commit message**: `feat(cli): render plan ambiguity with movedFrom hints`

### Phase 4: `keyshelf up` apply

> Parallel: no | Sequential dependencies: Phase 3
> User-visible change: command now mutates storage

#### Task 4.1: Add `copy` and `delete` to the provider interface

- **Description**: Two new methods. `copy(from, to)` writes the value at
  `from` to `to` without re-prompting; `delete(ctx)` removes a single
  storage entry.
- **Files**: `packages/cli/src/providers/types.ts`
- **Details**:
  - `copy` is a single provider-internal operation — not "decrypt then
    set" at the resolver level — because some providers (gcp) don't
    support true rename and need create-new-version + delete-old.
  - For `age`: file rename (decrypt+re-encrypt only if recipient has
    changed; in v5 it hasn't).
  - For `gcp`: `createSecret` at the new id, `addSecretVersion` with the
    payload from the old id, `deleteSecret` for the old id (only on the
    `delete` step, not inside `copy`, so the apply pipeline can verify
    the new entry exists before removing the old one).
  - For `sops`: read the JSON, decrypt the data key, copy the entry,
    re-MAC, write.
- **Commit message**: `feat(providers): add copy and delete capabilities`

#### Task 4.2: Implement the apply pipeline

- **Description**: Given a plan, execute it in safe order: all `copy`s
  first, verify each, then `delete`s.
- **Files**: `packages/cli/src/reconcile/apply.ts` (new),
  `packages/cli/src/reconcile/apply.test.ts` (new)
- **Details**:
  - For a `Rename`: call `provider.copy(from, to)`, then
    `provider.validate(to)`, then `provider.delete(from)`. If validate
    fails, abort apply and leave both — the next `up` will replan.
  - For a `Delete`: call `provider.delete(orphan)` directly.
  - For a `Create`: do nothing — `up` doesn't synthesize values; it
    prints the list of paths the user must `keyshelf set` next.
  - Apply is sequential, not parallel — failures are easier to reason
    about, and provider rate limits are real.
  - Idempotent: running `up` twice in a row is a no-op the second time.
- **Tests**: mock providers to verify ordering, abort-on-validate-failure,
  and idempotence.
- **Commit message**: `feat(reconcile): implement apply pipeline`

#### Task 4.3: Wire apply into the CLI

- **Description**: `keyshelf up` (no flags) prints the plan, prompts
  `Apply? [y/N]`, and runs apply on confirmation. `--yes` skips the
  prompt. `--plan` keeps the read-only behavior from Phase 3.
- **Files**: `packages/cli/src/cli/up.ts`
- **Details**:
  - On Ambiguous actions, refuse to apply with a clear error pointing at
    `movedFrom`. (Read-only `--plan` still renders the candidates.)
  - Print a one-line summary after apply: `Applied: 2 renames, 1 delete`.
- **Commit message**: `feat(cli): wire keyshelf up apply with confirmation`

### Phase 5: Schema hygiene for reversible storage parsing

> Parallel: yes | Sequential dependencies: none (can land any time after
> Phase 1, but pulling it forward is optional)
> User-visible change: validator rejects `_` and `__` in path segments

#### Task 5.1: Tighten path-segment validation

- **Description**: Reject path segments containing the separators that
  individual providers use to mangle paths into storage ids (`_` for age,
  `__` for gcp). This makes `list`'s reverse-mapping unambiguous.
- **Files**: `packages/cli/src/config/schema.ts`
- **Details**:
  - The current rule is `/^[A-Za-z_][A-Za-z0-9_-]*$/` (spec rule 7). Tighten
    to `/^[A-Za-z][A-Za-z0-9-]*$/` — drop `_` from both anchor and body.
  - Migration note: any existing v5 user with `_` in a key path must
    rename. Phase 5 PR description spells this out.
- **Commit message**: `feat(config): forbid underscore in path segments`

### Phase 6: Retire / rewire `mv`, `set`, `import`

> Parallel: no | Sequential dependencies: Phases 1–4
> User-visible change: `set` and `import` get a hint to run `up` after
> changes; no `mv` command is added.

#### Task 6.1: Add post-action hint to `set` and `import`

- **Description**: After a successful `set` or `import`, print a one-liner
  if the key being set isn't yet in storage according to the config-vs-
  storage diff. Conversely, if the user `set`s a key that was renamed in
  the config but storage still holds the old path, suggest `keyshelf up`.
- **Files**: `packages/cli/src/cli/set.ts`,
  `packages/cli/src/cli/import.ts`
- **Details**:
  - Don't run the full plan — too slow. Just check the single key being
    operated on against `provider.validate`.
  - Skip the hint if `--quiet` (or whatever flag the existing commands
    use; check before adding).
- **Commit message**: `feat(cli): hint at keyshelf up after set/import drift`

#### Task 6.2: Document `up` as the canonical verb

- **Description**: Update `docs/spec.md` and `README.md` to position `up`
  as the central command, with `set`/`import` as the value-mutation
  helpers and `run`/`ls` as consumers.
- **Files**: `docs/spec.md`, `README.md`
- **Details**:
  - Add a "Renaming a key" section showing the edit-then-`up` flow.
  - Document `movedFrom` as the disambiguation knob.
  - Note that `up` requires `list` permission on every provider — i.e.
    GCP IAM `roles/secretmanager.viewer` plus accessor.
- **Commit message**: `docs: position keyshelf up as the canonical reconcile verb`

## Testing Strategy

- **Phase 1** (provider `list`): unit tests per provider with fixture
  storage. For gcp, mock the SDK; for age and sops, write to a temp dir.
- **Phase 2** (planner): pure-function tests covering the matrix in Task
  2.2. No I/O.
- **Phase 3** (`up --plan`): integration tests that load a fixture config,
  use mock providers, and assert the rendered plan text.
- **Phase 4** (apply): integration tests for the success path, the
  validate-fails-abort path, and idempotence. Plus one end-to-end test
  that runs `up` twice against a real temp-dir age + sops setup and
  verifies the rename actually moved bytes.
- **Phase 5**: validator unit tests for the new rules.
- **Phase 6**: integration test that drift hints fire correctly.

## Out of Scope

- A separate `keyshelf mv` command. `up` infers the rename; an explicit
  command would be redundant once `movedFrom` exists.
- Cross-provider migrations (e.g. moving a key from `age` to `gcp`).
  That's a value-bearing migration, not a path move — handle with
  `keyshelf set` against the new provider, then `up` to clean up the
  orphan.
- Lockfile or sidecar state. The whole point of this design is that the
  config is the source of truth; introducing state files would undo it.
- Auto-applying renames detected via `git log` heuristics. Ambiguity
  resolution stays explicit via `movedFrom` to keep `up` deterministic
  in CI.
