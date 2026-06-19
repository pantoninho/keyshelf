# oclif as the CLI framework

## Decision

Keyshelf's CLI is built on **oclif** (v4).

## Why

The defining product goal is auto-discoverability — the CLI must be a first-class
citizen for coding agents. oclif is the only mainstream TypeScript CLI framework
that generates a **machine-readable command manifest** (`oclif.manifest.json`)
describing every command, argument, and flag. That manifest is precisely the
introspection artifact we deferred building by hand (a future MCP layer or an
agent can read it to enumerate the CLI reliably), so the discoverability goal is
served by the framework rather than by bespoke code. oclif is also the most
battle-proven structured CLI framework in the ecosystem (the Salesforce and
Heroku CLIs are built on it), with built-in help, flag parsing, plugins, and
testing utilities.

The main alternative, **commander**, is far more ubiquitous by download count and
leaner to start with, but provides no command manifest or introspection — we'd
hand-roll the discoverability surface and `--json` plumbing ourselves. Lighter
options (citty, clipanion, @stricli) are either less proven or, in clipanion's
case, still pre-release.

## Consequences

We accept oclif's heavier structure — class-per-command, more boilerplate and
build ceremony than commander — as the cost of getting the manifest and proven
foundations. This is a reasonable trade for a tool intended to grow more commands
and adapters over time. Swapping frameworks later would be a significant rewrite,
so this is a deliberately load-bearing choice.
