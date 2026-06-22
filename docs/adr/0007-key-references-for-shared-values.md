# Key references: a `!ref` representation for sharing a value across shelves

## Decision

A key may take a third **representation** (alongside config and `!secret`): a
**key reference**, written `!ref { shelf, key, stage }`. Instead of supplying a
value, it points at another key — `shelf` is required, `key` defaults to the
referencing key's own name, and `stage` defaults to the current stage. At `run`
the pointer is followed and the value is resolved from wherever it truly lives, so
a shared secret is **declared once** in a canonical shelf and pulled in by every
shelf that needs it (selecting and renaming a slice, per consuming shelf).

A key reference is resolved **one hop only**: it must land on a config or a
secret, never on another `!ref`. Resolution loads the target shelf's schema and
`{shelf}/{stage}.yaml`, resolves only the referenced key, and does so through the
**target environment's own provider**. This lives in `resolve.ts`, above the
adapter seam — adapters are untouched (ADR-0002).

Mechanics (exact `!ref` field defaults, the static validation checks and their
`REFERENCE_NOT_FOUND` / `INVALID_REFERENCE` codes, the `set --ref` authoring flags,
and precedence) live in `reference.md`, not here.

## Why

v6 dropped v5's one-big-namespaced-config model, and with it the ability to
declare a secret once and map it into many workspaces. The two fallbacks —
duplicating a secret under every shelf, or hand-writing raw backend locators in
`!secret { ref: … }` — are respectively un-rotatable and backend-coupled,
unvalidatable, and unable to cross stores (a sops shelf cannot point into another
sops shelf). A key reference restores "declare once, map + rename a slice" as a
first-class, domain-coordinate, cross-adapter, statically-validatable primitive.

**One hop only**, because forbidding `!ref → !ref` makes resolution cycles
impossible by construction (no cycle detector needed) and keeps resolution shallow
and predictable for humans and agents. It is also the safe direction: relaxing
one-hop to multi-hop later is backward-compatible, whereas tightening multi-hop to
one-hop is a breaking change. It covers every real case — canonical values live as
concrete secrets/config in one shelf and consumers point at them directly.

## Considered options

Three alternatives were rejected, each because it fights an existing decision:

- **Fold indirection into `!secret { from: … }`.** Reuses the secret machinery but
  forces the `!secret` tag onto values whose canonical representation is plaintext
  **config** — conflating sensitivity with indirection. A key reference must be
  representation-transparent (it may target a config or a secret), so it gets its
  own tag.
- **Declare references in `schema.yaml`** (shared once per shelf, across all
  stages). Rejected: schema governs **presence only** and representation is a
  per-environment decision (ADR-0001). Sourcing a value is a representation
  concern, so it belongs in the environment, and a schema-level reference also
  can't express stages that point at different targets.
- **Revive v5's shared storage namespace** (a provider whose namespace omits the
  shelf component, so equally-named keys collide onto one backend secret).
  Rejected: sharing becomes implicit and by-name-collision — the exact thing the
  `shelf` component in the v6 naming convention (ADR-0006) was added to prevent —
  with no rename, no explicit "this is shared" intent, and no cross-adapter reach.

## Consequences

Because a key reference resolves through the **target's** provider, the principal
running `keyshelf run <shelf>/<stage>` must also have read access to every
referenced environment's store (e.g. the shared GCP project, or the ability to
decrypt the canonical sops file). This is inherent to "the value lives in one
place," not a flaw, but it is an operational requirement to document.

Validation now reaches across shelves: validating an environment with a key
reference loads the target shelf's schema and environment to confirm the target
key exists, is present, and is itself config or secret (one hop). A dangling or
chained reference fails `validate` offline, before any `run`.

A new shape becomes possible: a **mapping environment** whose keys are all config
and/or `!ref`s, holding no local secret. Such an environment needs no provider of
its own — so `provider:` is now required only when an environment declares at
least one local `!secret`.
