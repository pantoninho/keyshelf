# gcp adapter: Google Cloud Secret Manager via the official SDK

## Decision

The `gcp` adapter stores Keyshelf secrets in **Google Cloud Secret Manager**,
talking to it through the official **`@google-cloud/secret-manager`** SDK (a
regular dependency, not optional). It implements the same two-method `Adapter`
contract (ADR-0002) as `sops` and `fake`, and passes the shared conformance
suites (ADR-0005).

Concrete choices:

- **Client: the official SDK, hard dependency.** Authentication is Application
  Default Credentials — the SDK resolves them from
  `GOOGLE_APPLICATION_CREDENTIALS`, `gcloud` ADC, or the metadata server — so
  Keyshelf owns no credentials. We do not shell out to `gcloud` (heavy, not
  bundled, fragile to parse). The SDK is a normal `dependency`: unlike the `sops`
  binary (per-platform, large, native — hence optional platform packages,
  ADR-0003), it is pure JS and small enough that conditional install isn't worth
  the lazy-load complexity.

- **Naming: one secret per key, by the fixed reference convention.** A key maps to
  a Secret Manager *secret* whose id is `{project}-{shelf}-{env}-{key}`, in the
  provider's `projectId`. The `{project}-{shelf}-{env}` prefix (the adapter's
  *namespace*) keeps the same key distinct across environments and shelves in a
  shared backend. `write` returns that id, which is exactly what `set` resolves by
  — so a convention write records a *bare* `!secret`. An explicit
  `!secret { ref: NAME }` resolves a differently-named secret; a `NAME` that is a
  full `projects/.../secrets/...` resource path resolves a foreign secret in any
  project.

- **Value encoding: JSON string, mirroring `sops`.** Secret Manager payloads are
  raw bytes, but it **rejects an empty payload** — and the contract requires an
  empty string to round-trip byte-exactly. So every value is carried as
  `JSON.stringify(value)` on `write` and `JSON.parse`d on `resolve`, exactly as
  the sops adapter does. An empty string becomes the two-byte `""`; all
  adversarial values (newlines, whitespace, quotes, unicode, multi-KB) round-trip
  byte-exactly.

- **Versions: write adds, resolve reads `latest`.** Each `write` adds a new secret
  version; `resolve` accesses the `latest` version, so a repeated write overwrites
  by superseding.

- **Replication from `location`.** Absent or `global` ⇒ automatic replication; any
  other value ⇒ user-managed replication pinned to that single region.

- **Error mapping (uniform, ADR-0005).** gRPC `NOT_FOUND` ⇒ `SECRET_NOT_FOUND`;
  `PERMISSION_DENIED` / `UNAUTHENTICATED`, and ADC credential-load failures thrown
  before any RPC ⇒ `PROVIDER_AUTH`; everything else ⇒ `ADAPTER_ERROR`. A missing
  required provider field (`projectId`) is a `MALFORMED_FILE`, raised at adapter
  construction.

## Why

The official SDK is the idiomatic, well-supported path: it handles ADC, retries,
and replication, and returns byte-exact payloads. Making it a hard dependency
trades a slightly larger install for simpler, branch-free code; the asymmetry with
the optional `sops` packages is deliberate and rooted in sops being a native
per-platform binary, which the SDK is not.

One-secret-per-key with the fixed `{project}-{shelf}-{env}-{key}` convention is the
same model `fake` already implements and `set` already resolves by, so the gcp
adapter slots into the existing reference-adapter behaviour with no new wiring in
callers. Carrying values as JSON strings reuses the proven sops trick and is the
cleanest way to satisfy both byte-fidelity and Secret Manager's no-empty-payload
rule with one mechanism.

## Consequences

There is no faithful local Secret Manager emulator, so the gcp conformance suite
runs **gated** against real infrastructure (ADR-0005): the `test/conformance/gcp.contract.test.ts`
harness runs only when `KEYSHELF_GCP_TEST_PROJECT` is set, namespacing every secret
by a unique per-run prefix and deleting them on teardown; the
`.github/workflows/gcp-conformance.yml` workflow runs it nightly when GCP
credentials are configured. Per-PR signal still rests on the hermetic `fake` +
`sops` matrix, plus the gcp adapter's own logic (naming, encoding, replication,
error mapping) which is unit-tested hermetically against an in-memory client
double (`test/unit/gcp.test.ts`).

The adapter assumes it owns the secrets under its namespace; values written
outside Keyshelf that are not JSON strings surface as `ADAPTER_ERROR` on resolve.
Old secret versions accumulate (Keyshelf never destroys them); lifecycle/rotation
of superseded versions is left to the backend's own policies.

## Running the gated suite locally

The gcp conformance suite needs a real project with the Secret Manager API
enabled and Application Default Credentials. It is effectively free: the harness
creates and deletes its secrets within seconds (create/destroy are non-billable
management operations and active-version billing prorates to ~zero), and a run
does far fewer than the free-tier 10,000 monthly access operations.

```sh
# One-time, against a non-production project you can write to:
gcloud auth application-default login
gcloud auth application-default set-quota-project <PROJECT_ID>
gcloud services enable secretmanager.googleapis.com --project <PROJECT_ID>

# Run it (skips silently without the env var):
KEYSHELF_GCP_TEST_PROJECT=<PROJECT_ID> npx vitest run test/conformance/gcp.contract.test.ts
# Optional: KEYSHELF_GCP_TEST_LOCATION=<region> to exercise user-managed replication.
```

Every secret is named with a unique per-run prefix and deleted on teardown, so a
shared project stays clean; verify with
`gcloud secrets list --project <PROJECT_ID> --filter="name~ksconf"`.
