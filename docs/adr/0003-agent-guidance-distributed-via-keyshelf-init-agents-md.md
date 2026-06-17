# Agent guidance reaches downstream repos via `keyshelf init` scaffolding `AGENTS.md`

Coding agents that work in a repo which has merely `npm install`ed keyshelf
inherit none of the agent guidance that lives in the keyshelf repo
(`skills/keyshelf/SKILL.md`, `CONTEXT.md`, `docs/spec.md`). The guidance must
**travel with adoption**. The chosen mechanism: a `keyshelf init` command
scaffolds a starter `keyshelf.config.ts` and writes a short **keyshelf section
into `AGENTS.md`** at the consuming repo's root. That section is a thin pointer —
"declare keys in `keyshelf.config.ts`; after editing, run `keyshelf check`; full
rules via `keyshelf rules`; spec in `docs/spec.md`" — not a copy of the ruleset.

## Status

accepted

## Considered Options

- **`keyshelf init` scaffolds `AGENTS.md` (chosen).** `AGENTS.md` is the
  cross-tool convention agents already look for, so the guidance is not tied to
  any one agent harness. It lands in the consuming repo at adoption time, so it
  is discoverable in-repo without the agent knowing keyshelf exists first. The
  section stays short and points at version-tracking sources (`keyshelf rules`,
  `keyshelf check`, `docs/spec.md`) so the scaffolded text itself carries little
  that can rot. Cost: it is a per-repo file the author owns, and the pointer
  prose can drift from the installed version if it ever duplicates rules — which
  is why the section deliberately defers to the commands rather than restating
  them.
- **Ship guidance in the npm package, recovered on demand via `keyshelf
rules`.** Rejected as the _primary_ mechanism: it always matches the installed
  version and adds no per-repo file, but it is undiscoverable — an agent only
  runs `keyshelf rules` if it already knows to. `keyshelf rules` remains the
  authoritative content source that the scaffolded `AGENTS.md` points at, so
  this option is subsumed, not discarded.
- **Claude Code plugin.** Rejected: packaging the skill as a plugin gives
  central updates and zero per-repo files, but it is Claude-Code-specific (not
  cross-tool) and requires the user to install it out of band. It does not help
  an arbitrary agent in a fresh checkout.

## Consequences

- **`keyshelf init` is a new command.** It must be idempotent and
  non-destructive: never overwrite an existing `keyshelf.config.ts`, and when
  `AGENTS.md` already exists, append/update only the keyshelf section. Tracked in
  [#169](https://github.com/pantoninho/keyshelf/issues/169).
- **The `AGENTS.md` section references commands that may not exist yet.**
  `keyshelf check` (validate loop) and `keyshelf rules` (recoverable agent
  guide) are separate slices. `init` scaffolds the references regardless — they
  are the documented agent entry points, and the pointer is correct even before
  the commands land.
- **`SKILL.md` becomes the source, not the delivery vehicle.** The in-repo
  `skills/keyshelf/SKILL.md` is the authoritative content that `keyshelf rules`
  surfaces; the scaffolded `AGENTS.md` points at it rather than duplicating it,
  keeping a single source of truth for the ruleset.
- **Teaching errors complement, not replace, this channel.** Actionable error
  messages ([#168](https://github.com/pantoninho/keyshelf/issues/168)) are the
  in-the-moment recovery path; `AGENTS.md` is the up-front discovery path. Both
  are needed.
