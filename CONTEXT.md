# keyshelf

keyshelf declares a project's config and secret keys once and resolves them per
environment through pluggable storage providers. One config (TS or v4 YAML), one
flattened set of keys, resolved for an active env.

## Language

**Key**:
A single declared config or secret entry, addressed by a `/`-separated path.
_Avoid_: Variable, entry, field

**Binding**:
The instruction that tells the resolver how to produce a key's value in a given
env — a scalar/template (config) or a `ProviderRef` (secret). Lives in `value`,
`default`, or a `values[env]` entry.
_Avoid_: Value (the resolved string is the value; the binding is the recipe)

**Fallback binding**:
A key's `value` / `default` — the envless binding used in any env not named in
its `values` map. A key with a fallback applies to every env.
_Avoid_: Default value

**Env-scoped key**:
A key with `values` entries but no fallback binding. It exists only in the envs
named in its `values` map; it is N/A everywhere else.
_Avoid_: Per-env key, conditional key

**Applicable env**:
An env in which a key participates. For a key with a fallback → every declared
env. For an env-scoped key → exactly the envs in its `values` map.
_Avoid_: Supported env, valid env

**N/A (not applicable)**:
A (key, env) pair where the env is not among the key's applicable envs. When an
env is active the key is excluded from that env's universe entirely — not
resolved, not listed, never an error — the env-driven analog of a key being out
of scope. Distinct from `optional` (which tolerates a missing binding _within_
an applicable env) and from a CLI `--filter`/`--group` (a user-supplied
selection that still reports the key as filtered).
_Avoid_: Skipped (an N/A key is invisible, not reported), disabled

**Optional key**:
A key that may legitimately have no value in an applicable env: the resolver
skips it instead of failing when its binding is absent or the provider reports
not-found. Orthogonal to applicability.
_Avoid_: Nullable, soft key

**Rot**:
A key that is applicable to the active env but does not resolve — an unseeded
or deleted binding. `ls --check` exists to catch rot; N/A exclusions must never
mask it (a key applicable to the active env that fails to resolve is always a
failure, never silently hidden).
_Avoid_: Drift (drift is a `keyshelf up` storage-vs-config concept)
