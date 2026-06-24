# Adapter-conformance testing: shared suites run against every adapter

## Decision

Adapter correctness is proven by **shared, adapter-agnostic conformance suites
run as a matrix over every adapter**, at two levels:

- **Adapter-contract suite** — exercises the `resolve`/`write` interface
  (ADR-0002) directly, pinpointing failures at the adapter boundary.
- **Black-box E2E suite** — spawns the real `keyshelf` binary and asserts through
  its public contract (`--json` output, exit status, file effects, the env a
  wrapped command actually sees), proving the whole wiring per adapter.

Both suites are written once, know nothing about which adapter is behind them, and
are made to run for each adapter by a small per-adapter **harness** that provisions
a provider config and does backend setup/teardown.

Both suites bake in two cross-cutting dimensions every adapter must satisfy:

- **Error-code mapping** — each adapter must translate native failures into the
  same structured codes (missing secret → `SECRET_NOT_FOUND`, bad creds →
  `PROVIDER_AUTH`, sops absent → `ADAPTER_UNAVAILABLE`, etc.), uniformly.
- **Value fidelity** — write/resolve round-trips are byte-exact for adversarial
  values: newlines, trailing whitespace, `=`, quotes, unicode, multi-KB blobs,
  and the empty string. A backend that cannot represent an empty value declares
  `supportsEmptyValue: false` on its harness and must instead reject it with
  `ADAPTER_ERROR` — the one sanctioned per-backend divergence (the `gcp` adapter,
  ADR-0006).

The matrix:

- `fake` (in-memory adapter) and `sops` run **every PR**, hermetically.
- `gcp` runs **gated** against real GCP infrastructure — only when credentials and
  an explicit opt-in are present (e.g. nightly on `main`), namespaced by a unique
  `{project}` prefix per run with teardown. There is no faithful local GCP Secret
  Manager emulator, so real infrastructure is the only way to prove that adapter.

Beneath conformance sit ordinary **unit tests** for pure logic (validation,
default←environment merge, key-name validation, precedence, resolution planning).
Tooling is **vitest** with real temp directories; development is **TDD against
`reference.md`**.

## Why

A shared conformance suite that every backend implementation must pass is the
established pattern for adapter/driver architectures — Terraform provider
acceptance tests (gated on `TF_ACC`, run against real cloud), gocloud.dev's
`drivertest`, the CSI sanity suite, SQL driver suites. It directly serves the goal
"make sure all adapters work as expected" and makes the new-adapter promise
concrete: write a harness, pass both suites including the error-mapping and
value-fidelity dimensions, and the adapter demonstrably behaves like every other.

Two levels rather than one because they answer different questions: the contract
suite _pinpoints_ boundary failures and covers edge cases the CLI can't express;
the E2E suite proves the end-to-end wiring. The in-memory `fake` adapter runs the
full matrix both as the fast per-PR lane and as a faithfulness check that keeps the
fake honest.

## Consequences

Running full suites against real infrastructure costs time, money, and credentials,
so gcp coverage is not hermetic and not per-PR — a deliberate trade accepted for
real-backend confidence. Per-PR signal rests on `fake` + `sops` (both hermetic);
gcp regressions are caught on the gated cadence rather than at PR time. Adding an
adapter carries a fixed cost: its harness plus whatever real backend the gated run
needs.
