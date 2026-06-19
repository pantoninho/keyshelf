import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'

/**
 * Build-time model of the bundled-sops distribution. These pure helpers turn the
 * single source of truth (`sops-version.json`) into the per-platform package.json
 * shapes that the generator writes and the unit/Verdaccio tests assert against.
 *
 * The five `@keyshelf/sops-{platform}-{arch}` packages each carry one platform's
 * static sops binary; npm installs only the one whose `os`/`cpu` matches the host
 * (ADR-0003), which is why `os`/`cpu` are load-bearing rather than cosmetic.
 *
 * Versioning philosophy (the decision the issue asks for): we **track the
 * upstream sops version** (clef-sh style) rather than locking to keyshelf's own
 * version (esbuild style). The binary is third-party sops, so its own release
 * number is the honest, greppable version to stamp; `sops-version.json` records
 * the exact getsops release the bytes came from.
 */

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
/** Repo root: scripts/lib -> scripts -> repo. */
export const repoRoot = path.resolve(moduleDir, '..', '..')

/** The five supported `{platform}-{arch}` targets, matching `process.platform`/`process.arch`. */
export const platforms = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64'] as const

export type PlatformKey = (typeof platforms)[number]

/** One platform's download + integrity record from `sops-version.json`. */
export interface BinaryEntry {
  /** The getsops release asset name to download (e.g. `sops-v3.13.1.linux.amd64`). */
  readonly asset: string
  /** Lowercase hex SHA256 the downloaded asset must match before it is packaged. */
  readonly sha256: string
}

/** The parsed `sops-version.json` source of truth. */
export interface SopsManifest {
  /** The bundled sops version, stamped on all five packages and the main optionalDependencies. */
  readonly sopsVersion: string
  /** The getsops/sops git tag the binaries are downloaded from (`v${sopsVersion}`). */
  readonly tag: string
  /** Per-platform asset + checksum records. */
  readonly binaries: Record<PlatformKey, BinaryEntry>
}

/** The committed package metadata for one platform package. */
export interface PlatformPackageJson {
  readonly name: string
  readonly version: string
  readonly description: string
  readonly license: 'MPL-2.0'
  readonly os: [string]
  readonly cpu: [string]
  readonly files: ['bin']
  readonly engines: {node: string}
  readonly dependencies?: never
  readonly optionalDependencies?: never
}

/** Read and parse the committed `sops-version.json`. */
export function loadSopsManifest(root: string = repoRoot): SopsManifest {
  const raw = readFileSync(path.join(root, 'sops-version.json'), 'utf8')
  return JSON.parse(raw) as SopsManifest
}

/** Split a `{platform}-{arch}` key into its npm `os`/`cpu` parts. */
export function osCpu(key: PlatformKey): {os: string; cpu: string} {
  const idx = key.lastIndexOf('-')
  return {os: key.slice(0, idx), cpu: key.slice(idx + 1)}
}

/** The binary file name inside `bin/` for a platform (`sops.exe` on win32). */
export function binaryName(key: PlatformKey): 'sops' | 'sops.exe' {
  return key.startsWith('win32-') ? 'sops.exe' : 'sops'
}

/**
 * Compute the package.json a platform package ships. `deps: none`, `MPL-2.0`,
 * version tracking the bundled sops release, and the load-bearing `os`/`cpu`.
 */
export function platformPackageJson(key: PlatformKey, manifest: SopsManifest): PlatformPackageJson {
  const {os, cpu} = osCpu(key)
  return {
    name: `@keyshelf/sops-${key}`,
    version: manifest.sopsVersion,
    description: `The sops ${manifest.sopsVersion} binary for ${os}/${cpu}, bundled for keyshelf. Installed automatically as a platform-specific optional dependency of keyshelf; not intended for direct use.`,
    license: 'MPL-2.0',
    os: [os],
    cpu: [cpu],
    files: ['bin'],
    engines: {node: '>=18'},
  }
}

/** The host's `{platform}-{arch}` key, or `undefined` if unsupported. */
export function hostPlatformKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): PlatformKey | undefined {
  const key = `${platform}-${arch}`
  return (platforms as readonly string[]).includes(key) ? (key as PlatformKey) : undefined
}
