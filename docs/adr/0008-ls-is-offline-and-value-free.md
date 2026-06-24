# `keyshelf ls` is offline and value-free

## Decision

`keyshelf ls` is a pure offline read of the project's files. It never touches a
backend, and it never prints a key's **value** — neither a committed plaintext
config nor a resolved secret. It reports **shape only**: which environments
exist, and for each key its schema **presence** (`required` / `optional` /
`default`) and its **status** in the listed environment (`config` / `secret` /
`ref → target` / `default` / `missing` / `unset`).

`ls` **may** build a provider/adapter — but only to compute a key's storage
**address** (e.g. a GCP Secret Manager resource path), never to resolve its
value. This is safe because adapter construction and the adapter's `metadata()`
method are offline and credential-free: the gcp client is constructed but never
called, and `metadata()` is **synchronous** (its non-`Promise` return
structurally forbids async I/O) and computed purely from already-parsed config
plus the key/ref. An adapter that cannot derive an address without a network
round-trip must not implement `metadata()` (the field is then omitted), and
`metadata()` must never trigger a backend call. An address is not a value, so
surfacing it does not breach the value-free rule.

It has two modes:

- `keyshelf ls` — a project map: every shelf, its schema's key count, and the
  environments under it.
- `keyshelf ls <shelf>/<stage>` — the full schema contract for one environment,
  each key annotated with its presence and this environment's status.

Resolving a `!ref`'s coordinate defaults (its target shelf/stage/key) is pure and
stays offline, so the `ref → target` it shows is computed without any backend
call. Following the reference to fetch the value is **not** done.

## Why

`ls` answers "what is here and what shape is it in?" — the cheap, credential-free
inventory that should work anywhere, instantly, with no network and no secrets in
your shell history. That role is only coherent if it is held apart from the two
commands that _do_ reach a backend: `validate` (proves secrets resolve) and `run`
(produces the actual values). Keeping `ls` offline is what makes it safe to run
in any directory, in CI logs, or over someone's shoulder.

Not printing values is the load-bearing half. Secret **values** must never reach
the terminal (ADR-0002) — so `ls` cannot resolve them. Config values _are_
committed plaintext and could be shown, but a table that prints config values
while masking secret values is lopsided and invites "why is this one blank?"
confusion, and it quietly turns a shape-inventory into a value-dump. Cleaner to
draw one line: **`ls` is about shape, `run` is about values.** Showing presence +
status surfaces the thing a human actually wants from an inventory — an unset
`required` key, a value resting on its default — without ever exposing a value.

## Consequences

A future contributor will be tempted to "help" by inlining config values, or by
resolving secrets so `ls` can show a `✓`/value next to each key. Both break the
boundary: resolving makes a supposedly-cheap command slow and credential-bound,
and printing values (even just config) erases the shape/value line and edges
toward leaking. If value display is ever wanted, it belongs behind an explicit,
clearly-named opt-in flag — never the default — and secret values stay off the
table regardless.

A storage **address** is the sanctioned exception, and it follows exactly that
rule. The address tells a user _where_ a secret lives (to find it in a console
or grant IAM), never _what_ it is. It is carried for every secret key in the
machine-consumption `--json` surface (which is already a structured,
opt-in-by-flag output), and in the human table only behind the explicit
`--metadata` flag — the default table stays lean. The load-bearing invariant is
unchanged: computing an address is offline and credential-free, and the moment
an adapter would need a network call to know an address, it omits it rather than
fetch.

Because `ls` never resolves, it cannot report whether a declared secret is
_actually_ resolvable — a `!secret` shows as `secret` whether or not the backend
holds it. That question is `validate`'s job, deliberately, and `ls` does not
duplicate it.
