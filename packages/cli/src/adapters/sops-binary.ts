import {execFileSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import process from 'node:process'
import {KeyshelfError} from '../errors.js'

/**
 * Resolve the `sops` binary to shell out to (ADR-0003). The distribution model is
 * a checksummed, **platform-specific npm optional dependency** — a tiny package
 * per `{platform}-{arch}` (`@keyshelf/sops-linux-x64`, `@keyshelf/sops-darwin-arm64`,
 * …) carrying just that platform's binary — so a single `npm i -g keyshelf`
 * brings a working sops with nothing else to install. Any `sops` on `PATH` is the
 * fallback, which also makes a hermetic CI runner (where a pinned real sops is
 * installed) Just Work without publishing the platform packages.
 *
 * Resolution order:
 *   1. an explicit override (`KEYSHELF_SOPS_BIN`) — used by tests to point at a
 *      throwaway or deliberately-broken binary;
 *   2. the bundled per-platform optional-dependency package for this host;
 *   3. any `sops` discoverable on `PATH`.
 *
 * A missing or unusable binary is **never** a raw spawn error: it surfaces as a
 * structured `ADAPTER_UNAVAILABLE` with a message that names the platform package
 * and the PATH fallback.
 *
 * NB: publishing the `@keyshelf/sops-*` platform packages to the registry is out
 * of scope for the MVP — the lookup logic and `optionalDependencies` wiring exist,
 * but until they ship the PATH fallback is what is actually exercised.
 */
export function resolveSopsBinary(): string {
  const override = process.env.KEYSHELF_SOPS_BIN
  if (override !== undefined && override.length > 0) {
    if (!existsSync(override)) {
      throw unavailable(`KEYSHELF_SOPS_BIN points at '${override}', which does not exist.`)
    }

    return override
  }

  const bundled = bundledBinaryPath()
  if (bundled !== undefined) return bundled

  const onPath = sopsOnPath()
  if (onPath !== undefined) return onPath

  throw unavailable(
    `No usable 'sops' binary found. Keyshelf bundles one as the optional dependency ` +
      `'${platformPackage()}'; install it (or any 'sops' on your PATH) to use the sops adapter.`,
  )
}

/** The optional-dependency package name carrying this host's bundled binary. */
export function platformPackage(): string {
  return `@keyshelf/sops-${process.platform}-${process.arch}`
}

/**
 * Locate the bundled binary inside its per-platform optional-dependency package,
 * if that package is installed. Each `@keyshelf/sops-*` package exposes its
 * binary at `bin/sops[.exe]`; we resolve the package's own `package.json` so the
 * lookup works regardless of where the dependency was hoisted.
 */
function bundledBinaryPath(): string | undefined {
  const pkg = platformPackage()
  const require = createRequire(import.meta.url)
  let pkgJson: string
  try {
    pkgJson = require.resolve(`${pkg}/package.json`)
  } catch {
    return undefined
  }

  const binary = path.join(path.dirname(pkgJson), 'bin', process.platform === 'win32' ? 'sops.exe' : 'sops')
  return existsSync(binary) ? binary : undefined
}

/** Find a `sops` on `PATH`, or `undefined` if none is discoverable/usable. */
function sopsOnPath(): string | undefined {
  const lookup = process.platform === 'win32' ? 'where' : 'which'
  try {
    const found = execFileSync(lookup, ['sops'], {encoding: 'utf8'}).split('\n')[0]?.trim()
    return found && found.length > 0 && existsSync(found) ? found : undefined
  } catch {
    return undefined
  }
}

function unavailable(message: string): KeyshelfError {
  return new KeyshelfError('ADAPTER_UNAVAILABLE', message)
}
