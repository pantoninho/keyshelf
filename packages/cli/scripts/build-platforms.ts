#!/usr/bin/env tsx
/**
 * Generate the five `@keyshelf/sops-{platform}-{arch}` packages under
 * `platforms/`. For each: download the pinned getsops release asset (cached),
 * SHA256-verify it against `sops-version.json` before writing anything, assemble
 * the package (`bin/sops[.exe]`, derived package.json, MPL-2.0 LICENSE), and —
 * for the host's own platform, the only binary this machine can execute —
 * smoke-test `sops --version` on the packaged binary.
 *
 * Usage:
 *   tsx scripts/build-platforms.ts            # all five platforms
 *   tsx scripts/build-platforms.ts --host     # only the host's platform (fast; Tier 1)
 *   tsx scripts/build-platforms.ts linux-x64  # a specific platform
 */
import process from 'node:process'
import {assemblePackage, downloadBinary, packageDir, smokeTest} from './lib/build.js'
import {hostPlatformKey, loadSopsManifest, platforms, type PlatformKey} from './lib/platforms.js'

async function main(): Promise<void> {
  const manifest = loadSopsManifest()
  const args = process.argv.slice(2)

  let targets: PlatformKey[]
  if (args.includes('--host')) {
    const host = hostPlatformKey()
    if (host === undefined) {
      throw new Error(`Unsupported host ${process.platform}-${process.arch}; no bundled sops package.`)
    }
    targets = [host]
  } else {
    const named = args.filter((a) => !a.startsWith('--'))
    targets = named.length > 0 ? (named as PlatformKey[]) : [...platforms]
  }

  for (const key of targets) {
    if (!(platforms as readonly string[]).includes(key)) {
      throw new Error(`Unknown platform '${key}'. Known: ${platforms.join(', ')}.`)
    }
  }

  const host = hostPlatformKey()
  for (const key of targets) {
    process.stdout.write(`• ${key}: downloading ${manifest.binaries[key].asset} … `)
    const binary = await downloadBinary(key, manifest)
    process.stdout.write('checksum ok … ')

    const out = packageDir(key)
    await assemblePackage(key, manifest, binary, out)
    process.stdout.write('packaged')

    if (key === host) {
      const version = smokeTest(`${out}/bin/${process.platform === 'win32' ? 'sops.exe' : 'sops'}`)
      if (!version.includes(manifest.sopsVersion)) {
        throw new Error(`Smoke test failed for ${key}: '${version}' does not report sops ${manifest.sopsVersion}.`)
      }
      process.stdout.write(` … smoke-test ok (${version})`)
    }
    process.stdout.write('\n')
  }

  process.stdout.write(`\nDone. ${targets.length} platform package(s) written to platforms/.\n`)
}

main().catch((error) => {
  process.stderr.write(`\nplatforms build failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
