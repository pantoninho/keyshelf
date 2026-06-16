# A `run --map` reference to an N/A key is an error

When a `keyshelf run --map` entry maps an env var to a key that is **N/A in
the active env** (an env-scoped key — see
[ADR-0001](./0001-env-applicability-derived-from-values.md) — whose `values`
map does not name the active env), the run **fails with an error**. It is not
silently dropped, and it does not emit a skip warning. From the map's point of
view an N/A key is effectively absent in this env, so referencing it fails just
like a reference to a key that does not exist at all.

## Status

accepted

## Considered Options

- **Error (chosen).** A map is user-authored and explicit: each entry asserts
  "this env var must come from this key in this env." When the key is N/A in the
  active env that assertion is false — almost always a typo, the wrong `--env`,
  or a stale map. Failing loudly surfaces the mismatch and matches keyshelf's
  fail-on-misconfiguration posture (the same posture that makes unresolved rot a
  failure). Exit non-zero; the subprocess does not run.
- **Skip with a reworded warning** (`is not applicable to env 'X'`). Rejected:
  this is what [#163](https://github.com/pantoninho/keyshelf/issues/163)
  originally proposed, but it lets a run the author clearly got wrong proceed
  with exit 0 and a var the author intended silently unset. A clearer message
  does not change that a likely-broken invocation still succeeds.
- **Silently drop, no output.** Rejected: maximally consistent with "N/A keys
  never appear in output," but an explicit user-supplied mapping is not the same
  as the env-driven universe sweep. Dropping it hides the author's mistake
  entirely — the most surprising failure mode of the three.

## Consequences

- **This supersedes the premise of #163.** That issue assumed a skip warning
  should remain and only be reworded; the resolution is instead to make the
  reference an error. The misleading `optional and has no value` text is removed
  along with the skip path for this case rather than corrected.
- **The N/A "never an error" rule is scoped to the env-driven sweep, not to
  explicit references.** ADR-0001 / CONTEXT.md describe an N/A key as "never an
  error" when keyshelf is _enumerating_ an env's universe (`ls`, bare `run`):
  nothing referenced the key, so its absence is silent. An explicit
  user-supplied `--map` reference is the opposite — the user named the key — so
  the "never an error" guarantee does not extend to it. CONTEXT.md is updated to
  draw this line.
- **Consistency with unknown keys.** A `--map` entry that points at a
  nonexistent key already fails; treating an N/A reference the same way means
  the map cannot reference a key the active env does not have, by any route.
- **Bare `run` (no `--map`) is unaffected.** It enumerates applicable keys and
  silently excludes N/A ones, exactly as ADR-0001 specifies — there is no
  explicit reference to be wrong.
