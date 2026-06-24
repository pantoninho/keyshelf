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
  a Secret Manager _secret_ whose id is `keyshelf__{project}__{shelf}__{stage}__{key}`,
  in the provider's `projectId`. The `keyshelf__{project}__{shelf}__{stage}` prefix
  (the adapter's _namespace_) keeps the same key distinct across environments and
  shelves in a shared backend. `write` returns that id, which is exactly what `set`
  resolves by — so a convention write records a _bare_ `!secret`. An explicit
  `!secret { ref: NAME }` resolves a differently-named secret; a `NAME` that is a
  full `projects/.../secrets/...` resource path resolves a foreign secret in any
  project.

  The `keyshelf__`-prefixed, `__`-separated form echoes keyshelf v5's styling
  (v5 was `keyshelf__{project}__{env}__{key}`, no shelf) on the v6 component
  structure. The double-underscore separator is more parse-robust than a single
  `-` when project/shelf/stage names themselves contain hyphens. GCP secret ids
  allow `[a-zA-Z0-9_-]`, so the underscores are valid, and v6 keys are single
  tokens matching `^[A-Z_][A-Z0-9_]*$` (never `/`-paths), so the composed id is
  unambiguous. This is intentionally **not byte-compatible** with secrets v5
  wrote: v6 inserts the `shelf` component, so a v6 convention name never collides
  with a v5 one and does not auto-resolve v5 secrets — migration is handled
  separately (#180).

- **Value encoding: raw bytes (the payload _is_ the value).** `write` stores
  `Buffer.from(value, "utf8")` and `resolve` returns the bytes verbatim. Secret
  Manager stores an opaque byte blob, so raw bytes round-trip byte-exactly for
  every value (newlines, whitespace, quotes, unicode, multi-KB) with no envelope.
  Storing the literal value is what lets **native consumers** — Cloud Run secret
  mounts, `gcloud`, Terraform data sources, other services — read the secret
  directly, which is the whole point of putting it in a _shared_ backend.

  > **Superseded.** This adapter originally carried values as `JSON.stringify(value)`,
  > mirroring `sops`. That was reversed (#233): the envelope poisoned every native
  > consumer (they received `"value"` with literal quotes) and broke the
  > foreign-secret feature below (a hand-created secret holds raw bytes, so
  > `JSON.parse` threw `ADAPTER_ERROR`). The envelope was solving only the empty-
  > string edge case — raw UTF-8 already round-trips everything else — at a cost
  > that defeats the reason to choose Secret Manager. Unlike `sops` (which still
  > needs the envelope to survive YAML's implicit typing, and has no native
  > external consumer), `gcp` keeps values raw.

  The one value with no raw representation is the **empty string**: Secret Manager
  rejects an empty payload, and an empty secret has no native form to mount
  anyway. So `write` **rejects an empty value** with `ADAPTER_ERROR` up front,
  rather than smuggle it through an envelope no native consumer could read. This
  is the adapter contract's single sanctioned divergence from the uniform
  empty-string round-trip (ADR-0005); the conformance harness marks it with
  `supportsEmptyValue: false`.

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

One-secret-per-key with the fixed `keyshelf__{project}__{shelf}__{stage}__{key}` convention is the
same model `fake` already implements and `set` already resolves by, so the gcp
adapter slots into the existing reference-adapter behaviour with no new wiring in
callers. Storing the raw value keeps the payload identical to what any native GCP
consumer expects, so the secret Keyshelf writes is the secret Cloud Run mounts —
no decode step, no `JSON.parse` that a foreign secret would fail. The empty
string is the only value Secret Manager cannot hold, and an empty secret is a
smell with no native representation, so rejecting it is a cleaner contract than an
envelope that breaks every other reader.

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

Because values are stored raw, a foreign or hand-created secret resolves
correctly through `!secret { ref: ... }` — its literal bytes are the value, with
no envelope to parse (this is the bug the JSON-string scheme caused, now fixed).
Secrets Keyshelf writes are also directly mountable into Cloud Run and readable
by `gcloud`/Terraform without unwrapping. The tradeoff: the gcp adapter cannot
store an empty value (rejected on `write`), the one place it diverges from the
otherwise-uniform value contract. Old secret versions accumulate (Keyshelf never
destroys them); lifecycle/rotation of superseded versions is left to the
backend's own policies.

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
