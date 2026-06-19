# Distribution: the bundled sops binary

Keyshelf shells out to `sops` and bundles it as **five per-platform npm optional
dependencies** (ADR-0003), the same pattern esbuild (`@esbuild/{platform}-{arch}`)
and Biome (`@biomejs/cli-{platform}-{arch}`) use, and the same shape as
clef-sh's `@clef-sh/sops-*`. One `npm i -g keyshelf` brings a working sops with
nothing else to install.

## The five packages

| Package                       | `os`     | `cpu`   | binary         |
| ----------------------------- | -------- | ------- | -------------- |
| `@keyshelf/sops-linux-x64`    | `linux`  | `x64`   | `bin/sops`     |
| `@keyshelf/sops-linux-arm64`  | `linux`  | `arm64` | `bin/sops`     |
| `@keyshelf/sops-darwin-x64`   | `darwin` | `x64`   | `bin/sops`     |
| `@keyshelf/sops-darwin-arm64` | `darwin` | `arm64` | `bin/sops`     |
| `@keyshelf/sops-win32-x64`    | `win32`  | `x64`   | `bin/sops.exe` |

Each package:

- declares `"os"`/`"cpu"` — **the load-bearing field**: npm installs only the
  package whose `os`/`cpu` matches the host and silently skips the other four, so
  a normal install pulls one ~30–50 MB binary, not five;
- has **`deps: none`** — it is a pure binary carrier (no `bin` command either; the
  resolver locates the file by path via `require.resolve`, matching esbuild);
- is licensed **`MPL-2.0`** — sops's license, since these redistribute sops
  itself, _not_ keyshelf's MIT.

**No `-gnu`/`-musl` libc split.** SWC/Rollup/lightningcss split linux on libc
because they link native code; **sops is a statically-linked Go binary**, so one
`linux-x64` package works on both glibc and musl/Alpine. The set stays flat at
five (esbuild/Biome style).

## Single source of truth & versioning decision

`sops-version.json` at the repo root is the single source of truth. It pins the
sops version, the getsops release tag, and per-platform asset name + SHA256. It
drives the version stamped on all five packages **and** the
`optionalDependencies` ranges in the main `package.json` (a unit test asserts they
agree).

**Versioning philosophy — we track the upstream sops version (clef-sh style),
not keyshelf's own version (esbuild style).** esbuild locks its platform packages
to the main package version because the binary _is_ esbuild. Our binary is
third-party sops, so its own release number (`3.13.1`) is the honest, greppable
version to publish, and `sops-version.json` records the exact getsops release the
bytes came from. The five packages and the main `optionalDependencies` are all
`3.13.1`.

To bump sops: edit `sops-version.json` (version, tag, asset names, the SHA256s
from the release's `sops-<tag>.checksums.txt`), update the `optionalDependencies`
ranges to match, and re-run the build.

## Build & integrity pipeline

`npm run platforms:build` (`scripts/build-platforms.ts`) for each platform:

1. **downloads** the pinned asset from the getsops/sops GitHub release (cached in
   `.cache/sops-binaries/`, gitignored, so the test suite never re-downloads);
2. **SHA256-verifies** the bytes against `sops-version.json` _before packaging_ —
   a tampered/mismatched binary throws and fails the build (`verifySha256`);
3. **assembles** `platforms/sops-{platform}-{arch}/` (binary at `bin/sops[.exe]`
   mode 0755, the derived `package.json`, sops's MPL-2.0 `LICENSE`);
4. **smoke-tests** `sops --version` on the host's packaged binary (the only one
   this machine can exec).

`platforms/` and `.cache/` are gitignored: the committed source of truth is
`sops-version.json` + the generator, never the heavyweight binary output.

## Verifying without publishing

Nothing is published to npmjs.com. Two tiers (`test/platforms/`):

- **Tier 1 — no registry** (`tier1-no-registry.test.ts`): `npm pack` each platform
  package and assert the tarball carries `bin/sops[.exe]` with the right
  `os`/`cpu`/`license`; then `file:`-install keyshelf + the host platform package
  into a temp project and drive a real `keyshelf run` through every resolver
  state — bundled-only (with `sops` scrubbed from PATH), PATH fallback, and
  `ADAPTER_UNAVAILABLE`.
- **Tier 2 — local Verdaccio** (`tier2-verdaccio.test.ts`, `scripts/lib/verdaccio.ts`):
  stand up an **ephemeral 127.0.0.1 Verdaccio**, publish all five platform
  packages + keyshelf to it, `npm i keyshelf` from the local registry, and assert
  npm's real `os`/`cpu` selection landed **only** the host's platform package.
  keyshelf + `@keyshelf/*` are local-only (no uplink proxy) so they can never leak
  to npmjs.com; third-party runtime deps are fetched read-only through an npmjs
  uplink. Every publish/install carries an explicit local `--registry`.
  Runnable standalone via `npm run verdaccio`.

## Publishing (authored, gated, not yet fired)

`.github/workflows/publish.yml` builds all five packages, runs the checksum +
smoke-test gates, and publishes with `npm publish --provenance` via OIDC — but is
**gated so merging a PR publishes nothing**:

1. it triggers **only on a `v*` release tag** (no `push: branches` / `pull_request`
   trigger), and
2. the publish step is **skipped unless `secrets.NPM_TOKEN` is present** — and the
   `@keyshelf` scope has no token/OIDC trusted publisher configured yet.

A reviewer can confirm by inspection that no publish happens on merge or PR.

### Human-only handoff (out of scope here)

- Configure the npm **trusted publisher (OIDC)** / `NPM_TOKEN` for `@keyshelf`.
- The first live `npm publish` (by pushing a `v*` tag) and verifying a clean
  `npm i -g keyshelf` pulls exactly one platform package.
- After that lands: remove the now-redundant CI `sops` install.
