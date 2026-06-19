# TypeScript with a bundled sops binary

## Decision

Keyshelf is implemented in **TypeScript** and distributed via **npm**. The sops
adapter shells out to the `sops` binary, which is **bundled as a checksummed,
platform-specific npm optional dependency**, falling back to any `sops` found on
PATH. One `npm i -g` brings everything; the user never installs sops separately.
Keyshelf implements no cryptography itself.

## Why

The hard requirements were: an agent-first, "self-contained" CLI that supports a
sops-backed local adapter. Three alternatives were considered and rejected:

- **Go with embedded sops.** sops is written in Go, so the adapter could import it
  in-process and produce a single static binary with zero runtime dependencies —
  technically the cleanest fit. Rejected for TypeScript on the basis of
  development velocity and ecosystem familiarity (and a first-class cloud-SDK
  story for the future gcp/aws adapters).
- **Reimplement sops in JS.** The npm sops libraries (`sops-age`, `sops-decoder`,
  `@figedi/sops`) are decrypt-only; `set` requires encryption. Hand-rolling
  sops's AES-GCM + MAC + key-wrapping format is security-sensitive and high-risk.
  Rejected.
- **Native `age`-encrypted store (drop sops).** Fully self-contained and low-risk,
  but loses sops-format compatibility and the `.sops.yaml` workflow (see ADR-0002),
  and makes keyshelf own recipient management. Rejected because real sops
  compatibility was wanted.

Bundling the sops binary (the pattern used by the `clef` project's
`@clef-sh/sops-*` packages) is the only option that is simultaneously
self-contained for the user, fully sops-compatible, and free of hand-rolled
crypto.

"Self-contained" was clarified to mean "one install, nothing else to set up" —
not "one literal binary file." That ruled out a `bun --compile` single binary that
embeds and extracts sops at runtime, in favor of the simpler npm + optional-deps
mechanism.

## Consequences

The published package carries per-platform binaries and is therefore larger, and
the bundled binary's checksum must be verified as a supply-chain measure. The sops
binary is a per-provider prerequisite only — a user of just a gcp provider never
needs it — and a missing/unusable sops surfaces as a structured
`ADAPTER_UNAVAILABLE` error rather than a raw spawn failure.
