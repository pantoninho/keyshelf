# Secret version pinning: an env-file `version: N` that gates rotation on a deploy

## Decision

A `!secret` reference may **pin a concrete backend version**, turning the
committed environment file into a version lockfile. Pinning extends — and does
not reshape — the two-method adapter contract (ADR-0002), the conformance suites
(ADR-0005), and the gcp adapter (ADR-0006).

Two modes ride one mechanism:

| Mode     | Reference                | Resolution                                            |
| -------- | ------------------------ | ----------------------------------------------------- |
| Floating | bare `!secret` (today)   | the backend's `latest` — value change needs no deploy |
| Pinned   | `!secret { version: N }` | exactly version `N` — value change is a manifest diff |

### 1. `set` default — pinned on versioned adapters; bare `!secret` stays floating

This is the load-bearing decision (the issue's open question 1), settled by the
maintainer before hand-off and recorded here verbatim in spirit:

- **Non-versioned adapters (sops):** pinning is **N/A**. A sops value lives in the
  committed sibling encrypted file, so it is _already_ deploy-gated by
  construction — a value change is already a git diff. There is no behavior
  change, and `set` records no version. The adapter declares
  `supportsVersionPinning: false`.
- **Versioned adapters (gcp / future remote):** `keyshelf set --secret` **records
  the concrete version it wrote** in the env-file reference **by default**
  (pinned). A `--floating` flag opts out, recording a bare `!secret`.
- **Backward compatibility:** a bare `!secret` continues to resolve `latest`
  (floating). Existing manifests are unaffected; only _new_ `set` calls begin
  pinning. The change is **additive, not breaking**.

The rationale (recorded so the decision is not re-litigated):

1. **Adapter consistency.** sops is inherently deploy-gated; gcp is the only
   adapter where a value floats _outside_ the committed manifest. Pinned-by-default
   makes gcp behave like sops — across all adapters, a value change becomes a
   committed, diffable, deploy-gated event (in the spirit of the ADR-0005 uniform
   contract).
2. **Honest manifest.** keyshelf's core principle is that the env file is the
   committed, diffable source of truth. Pinning makes the file _fully determine_
   what resolves, instead of saying `!secret` over a value that mutates underneath.
3. **Reproducible deploys.** Checking out an old commit and deploying yields the
   value current _at that commit_, not whatever is `latest` now.
4. **Safe by default.** The convenient-but-surprising auto-propagation becomes an
   explicit `--floating` opt-in rather than the path of least resistance.

### 2. Reference shape — additive `version:` on the existing `!secret` payload

- Bare `!secret` stays floating (`latest`) — unchanged, backward compatible.
- `!secret { version: N }` is the pinned **convention** form (the value lives
  under the convention name; access version `N`).
- `!secret { ref: NAME, version: N }` composes pinning with the existing explicit
  foreign reference (ADR-0006): a foreign/pre-existing secret pinned to a version.
- `version` is a positive integer. The `!secret` payload shape is adapter-defined
  (ADR-0002), so core stays version-agnostic: it parses and round-trips the
  payload, and the gcp adapter is the only code that _interprets_ `version`.

### 3. Adapter contract — `write` surfaces the version; `resolve` honors a pin

The two-method contract (ADR-0002) is intact; one return shape widens:

- `write(key, value)` returns a `WriteResult = { ref: unknown; version?: string }`.
  `ref` is exactly the prior return (the stored name, or `undefined` for a
  convention write). `version` is the **concrete version `write` created**, set
  only by adapters that version (gcp); `undefined` elsewhere (sops, fake). This is
  what lets `set` record `version: N`.
- `resolve(key, ref)` **honors a pinned version when the ref payload carries one**,
  else resolves `latest` — unchanged for a bare ref. The pin is interpreted inside
  the adapter (gcp), so the seam stays version-agnostic.
- `metadata(key, ref)` (ADR-0008) addresses the **pinned version's** resource when
  the ref pins one, else `.../versions/latest` — so `ls` surfaces the pin offline.

### 4. Non-versioned adapters — a `supportsVersionPinning` conformance capability

Mirroring `supportsEmptyValue` (ADR-0005/0006), the harness declares
`supportsVersionPinning` (default `false`, since most stores hold one value per
key). The gcp harness opts in with **`true`**; sops (and the in-memory `fake`)
leave it **false** — a pinned `version` is meaningless for a sibling-file store,
which is already deploy-gated by being committed. The shared contract suite
gates its pinning cases on this flag — adapters that pin exercise pinned +
floating resolution and the `write`→`version` round-trip; adapters that do not
skip those cases. gcp's hermetic unit tests (in-memory client double) cover the
pinning logic per-PR; the gated gcp conformance run exercises it on real
infrastructure (ADR-0005, ADR-0006).

### 5. `ls` / metadata — the pin is visible offline

A pinned secret's `ls` adapter metadata addresses `.../versions/N` (not
`/latest`), so the pin is visible without any backend access (ADR-0008). The
`--json` shape always carries it; the human table shows it behind `--metadata`.

### 6. Re-pin workflow — `set --pin-latest`

To bump a pinned secret to the latest version _without changing the value_ (the
counterpart to pinned-by-default), `set --pin-latest` reads the current latest
version from the backend and records it — no value is read from stdin and no new
version is written. It is the symmetric escape hatch: `--floating` removes the
pin, `--pin-latest` advances it. `--pin-latest`, `--floating`, and `--secret`
(value-writing) are mutually exclusive. For a non-versioned adapter (sops)
`--pin-latest` is a no-op error (`ADAPTER_ERROR`-class: pinning unsupported),
since there is no version to advance to.

### 7. Cross-reference to Cloud Run (`secretKeyRef`) — noted, not implemented

If keyshelf later emits Cloud Run `secretKeyRef` config (#241), the linkage is
direct: pinned → `version: N`, floating → `latest`. This ADR establishes the
env-file form that makes _either_ consumption path (native `secretKeyRef` or the
`keyshelf run` wrapper) deploy-gate a value change. The emission itself is out of
scope here.

## Why

Per ADR-0006 the gcp adapter's `write` adds a version and `resolve` reads
`latest`, so a `keyshelf set` reaches newly-started instances with no deploy and
no diff. That is convenient but invisible. Pinning is the smallest mechanism that
makes rotation an explicit, audited, deploy-gated event while leaving floating
available — and it lands as an _additive_ payload field on the existing `!secret`
tag, so nothing about today's references or resolution changes until a user opts
in (or accepts the new pinned-by-default `set`).

Keeping `version` interpretation inside the adapter honors ADR-0002: the payload
shape is adapter-defined, core round-trips it, and only the versioned adapter
reads it. That is why no new adapter _method_ is needed — the pin travels in the
ref payload `resolve`/`metadata` already receive, and only `write`'s return
widens (to report the version it just created). A `supportsVersionPinning`
capability slots pinning into the established conformance pattern exactly as
`supportsEmptyValue` did, so sops's "pinning is N/A" is a declared, tested
divergence rather than an unstated gap.

## Consequences

- **gcp** is the first adapter to interpret `version`. A pinned `resolve` accesses
  `.../versions/N` directly; a missing pinned version surfaces `SECRET_NOT_FOUND`
  uniformly (ADR-0005), exactly as a missing secret does. Old versions still
  accumulate (keyshelf never destroys them, ADR-0006) — a pin merely _names_ one.
- **`set --secret` on gcp now mutates the env file with `version: N` by default.**
  This is the intended deploy-gating behavior, but it means a `set` that
  previously produced a no-op diff (bare `!secret` already present) now writes a
  `version:` line. `--floating` restores the old behavior for users who want
  auto-propagation.
- **sops** is unchanged: it declares `supportsVersionPinning: false`, ignores any
  `version` on resolve (a sibling-file store has one value), and `set` records no
  version. A hand-authored `version:` on a sops `!secret` is inert.
- The **conformance matrix** grows pinning cases gated on the new capability, so
  every future versioned adapter must demonstrate pinned + floating resolution and
  the `write`→`version` round-trip to pass.
- **Reproducibility** improves for pinned deploys; the cost is that a rotation now
  takes two steps for pinned secrets (write the new version, then ship the manifest
  diff), which is the explicit deploy-gate the feature exists to provide.
