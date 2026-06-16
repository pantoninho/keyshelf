# Env applicability is derived from the `values` map, not declared

A key's `values` map _is_ its declaration of which envs it applies to. A key
with `values` entries and no `value`/`default` fallback (an **env-scoped key**)
is **N/A** in any env outside its `values` keys: when that env is active the key
is excluded from the env's universe entirely — not resolved, not listed, never an
error — across `run`, `ls --env`, `ls --reveal`, and `ls --check`. A key with a
fallback still applies to every env (unchanged). See [CONTEXT.md](../../CONTEXT.md)
for the vocabulary.

## Status

accepted

## Considered Options

- **Derive from `values` (chosen).** No new syntax. The presence of a binding is
  the assertion "this key must resolve in this env," so its _absence_ (for an
  env-scoped key) means "N/A here." Rot detection is fully preserved: a key
  applicable to env X that fails to resolve still FAILs.
- **Explicit per-key field** (`requiredIn` / `appliesTo`). Rejected: it lets a
  key carry a binding for an env while declaring that env N/A — a present-but-
  ignored binding that can silently mask real rot, the exact failure mode this
  check exists to catch. It also duplicates information the `values` map already
  encodes in the v5 TS form.
- **Reuse the per-app env allowlist (#144).** Rejected: that mechanism is
  map-scoped (`run` / `ls --map`); it does not reach the map-less exhaustive
  `ls --check` sweep this decision is about.

## Consequences

- **The binding is the source of truth.** To mark an env-scoped key N/A in an
  env, omit its binding for that env. Writing a binding to storage that is
  intentionally empty (e.g. `staging: gcp(...)` for a secret deliberately not
  seeded in staging) keeps the key _applicable_ and will FAIL — that binding
  must be removed, not annotated. This drove a config migration in the
  motivating repo (sunsay/core).
- **Omission is not caught.** A key that _should_ apply to env X but lost its X
  binding silently vanishes from `ls --check --env X` rather than failing.
  Accepted because the v5 TS config is reviewed code, not live storage — an
  omitted binding is a code-review concern, not the storage rot `ls --check`
  guards against.
- **`optional` stays orthogonal.** N/A excludes a key before resolution;
  `optional` tolerates a missing/not-found binding _within_ an applicable env.
  The two compose without conflict.
- A key with a `value`/`default` fallback can never be N/A — it applies to every
  declared env, preserving today's behavior for keys with no env-scoping.
