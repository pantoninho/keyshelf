# `keyshelf ls` is offline and value-free

## Decision

`keyshelf ls` is a pure offline read of the project's files. It never builds a
provider and never touches a backend, and it never prints a key's **value** —
neither a committed plaintext config nor a resolved secret. It reports **shape
only**: which environments exist, and for each key its schema **presence**
(`required` / `optional` / `default`) and its **status** in the listed
environment (`config` / `secret` / `ref → target` / `default` / `missing` /
`unset`).

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

Because `ls` never resolves, it cannot report whether a declared secret is
_actually_ resolvable — a `!secret` shows as `secret` whether or not the backend
holds it. That question is `validate`'s job, deliberately, and `ls` does not
duplicate it.
