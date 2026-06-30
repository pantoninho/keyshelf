# Environments live in a reserved `environments/` folder; stores live outside core's namespace

## Decision

A shelf's environment files move into a dedicated `environments/` subfolder, and an
adapter's store moves out of the folder core scans. The shelf layout becomes:

```
.keyshelf/{shelf}/
  schema.yaml            # the shelf's contract        (core)
  environments/          # the one folder core scans    (core)
    production.yaml
    staging.yaml
  secrets/               # the sops adapter's default store (sops only)
    production.yaml
```

Environment discovery is now a plain directory read of `.keyshelf/{shelf}/environments/*.yaml`
with **no exclusion rule**: every `*.yaml` in that folder is an environment, its
stage is its basename. There is no `isEnvironmentFile` predicate, no `schema.yaml`
special-case (the schema is a sibling of `environments/`, not inside it), and no
`.secrets.yaml` special-case.

`environments/` is the **only** folder name core reserves. `secrets/` is not a core
concept — it is merely the sops adapter's _default_ store directory, and the
provider's `store:` template remains configurable. The store contract is now
statable in one line: a store may live anywhere under the shelf **except inside
`environments/`**. Because the store lives in its own directory, the
`{stage}.secrets.yaml` suffix loses its only job (disambiguation within a shared
directory) and the sops default simplifies to `secrets/{stage}.yaml`.

## Why

This supersedes the **layout** decided in ADR-0002 — the sibling
`{shelf}/{stage}.secrets.yaml` store and the flat `{shelf}/{stage}.yaml`
environment file — while leaving ADR-0002's reference model intact (secret values
still live in adapter-owned stores; environment files still hold only `!secret`
references).

The flat layout forced core to discriminate, by filename, between three kinds of
file sharing one directory. Discovery globbed `*.yaml` and excluded `schema.yaml`
and `*.secrets.yaml`. That coupling was wrong in two concrete ways:

- **A sops detail leaked into core.** `.secrets.yaml` is the sops adapter's store
  convention, yet core hardcoded the suffix to avoid mis-enumerating store files
  as environments. Core had no business knowing it.
- **It mirrored a _configurable_ default as if it were a law.** The sops `store:`
  template is overridable. A store configured as `{shelf}/{stage}.enc.yaml` lands a
  `.yaml` file in the shelf directory that is neither `schema.yaml` nor
  `*.secrets.yaml` — so core would have listed it as an environment. The exclusion
  only happened to match the sops _default_.

Giving environments their own folder makes the seam **structural** instead of
lexical. The special case does not move into the adapter — it is deleted. Core
scans one folder and trusts everything in it; the adapter owns its store namespace
entirely. This is the cleanest expression of the boundary ADR-0002 already drew:
core describes _what_ keys exist and where environments are; the adapter decides
_how and where_ values are stored.

A named `environments/` folder is also more discoverable than a suffix convention,
which suits a tool meant to be navigable by humans and agents (CONTEXT.md): the
folder says what it holds, rather than requiring the reader to infer that
`production.yaml` is an environment but `production.secrets.yaml` is not.

## Consequences

- **`isEnvironmentFile` is removed.** Discovery (`listEnvironments` /
  `listShelfEnvironments`) reads `environments/` directly. A missing or empty
  `environments/` folder means zero environments, not an error.
- **Stage names are no longer constrained.** Discrimination is by directory, not by
  counting dots in a filename, so a stage name containing a dot is no longer
  ambiguous with a store file.
- **Path construction funnels through helpers.** The flat `{shelf}/{stage}.yaml`
  assumption is replaced by `envFilePath(root, shelf, stage)` and
  `shelfEnvDir(root, shelf)`; the sops default store path moves to
  `secrets/{stage}.yaml` in the adapter registry. `init` scaffolds the new layout.
- **Not a breaking release.** keyshelf's npm `latest` is the 5.x line; the 6.x line
  ships only on the `next` pre-release tag. No stable consumer has the flat layout
  on disk, so this lands as a `feat` on 6.x rather than a major bump. The only
  affected parties are `next` adopters, who move their files from
  `{shelf}/{stage}.yaml` into `{shelf}/environments/` and their sops stores into
  `{shelf}/secrets/`; this is noted for them in the migration docs rather than
  automated. Getting the layout right now — before 6.x is promoted to `latest` — is
  what keeps it non-breaking; the same change after promotion would break stable
  users.
- **Conformance is unaffected in shape (ADR-0005).** The adapter contract
  (`resolve`/`write`) does not change; only the default store path the registry
  computes for sops moves. `ageKeyFile` (ADR-0010) is unaffected — it resolves
  relative to the project root, independent of the store's location.
