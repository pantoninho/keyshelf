#!/usr/bin/env tsx
/**
 * Standalone, locally-runnable Tier 2 verification (issue #14): stand up an
 * ephemeral local Verdaccio, publish all five `@keyshelf/sops-*` platform
 * packages + keyshelf to it, install keyshelf from it into a clean dir, and
 * assert that ONLY the host's platform package was selected (the other four
 * skipped by npm via os/cpu). Tears the registry down at the end.
 *
 * This is the same flow the vitest Tier 2 suite runs; it exists as a script so it
 * can be exercised by hand (`npm run verdaccio`) without the test harness. It
 * NEVER publishes to npmjs.com — only to the explicit local 127.0.0.1 registry.
 *
 * Usage: npm run verdaccio
 */
import {execFile} from 'node:child_process'
import {existsSync} from 'node:fs'
import {mkdtemp, readdir, rm, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import {promisify} from 'node:util'
import {packageDir} from './lib/build.js'
import {hostPlatformKey, platforms, repoRoot} from './lib/platforms.js'
import {publishToRegistry, startVerdaccio} from './lib/verdaccio.js'

const execFileAsync = promisify(execFile)

async function ensureBuilt(): Promise<void> {
  const missing = platforms.filter((key) => !existsSync(path.join(packageDir(key), 'package.json')))
  if (missing.length === 0) return
  process.stdout.write(`Building ${missing.length} missing platform package(s) …\n`)
  await execFileAsync('npx', ['tsx', 'scripts/build-platforms.ts'], {cwd: repoRoot, maxBuffer: 64 * 1024 * 1024})
}

async function main(): Promise<void> {
  const host = hostPlatformKey()
  if (host === undefined) throw new Error(`Unsupported host ${process.platform}-${process.arch}`)

  await ensureBuilt()
  process.stdout.write('Starting local Verdaccio …\n')
  const registry = await startVerdaccio()
  process.stdout.write(`  registry: ${registry.url}\n`)

  try {
    for (const key of platforms) {
      process.stdout.write(`Publishing @keyshelf/sops-${key} … `)
      await publishToRegistry(packageDir(key), registry)
      process.stdout.write('ok\n')
    }

    process.stdout.write('Publishing keyshelf … ')
    await publishToRegistry(repoRoot, registry)
    process.stdout.write('ok\n')

    const proj = await mkdtemp(path.join(os.tmpdir(), 'keyshelf-verdaccio-verify-'))
    try {
      await writeFile(
        path.join(proj, 'package.json'),
        JSON.stringify({name: 'verdaccio-verify', version: '1.0.0', private: true}, null, 2),
        'utf8',
      )
      process.stdout.write('Installing keyshelf from the local registry … ')
      await execFileAsync(
        'npm',
        ['install', 'keyshelf', '--registry', `${registry.url}/`, '--userconfig', registry.userconfig, '--no-audit', '--no-fund'],
        {cwd: proj, env: registry.npmEnv(), maxBuffer: 64 * 1024 * 1024},
      )
      process.stdout.write('ok\n')

      const scopeDir = path.join(proj, 'node_modules', '@keyshelf')
      const present = existsSync(scopeDir) ? (await readdir(scopeDir)).filter((d) => d.startsWith('sops-')) : []
      const expected = [`sops-${host}`]
      const ok = present.length === 1 && present[0] === expected[0]
      process.stdout.write(`\nInstalled @keyshelf/sops-* packages: ${present.join(', ') || '(none)'}\n`)
      process.stdout.write(`Expected exactly: ${expected.join(', ')}\n`)
      if (!ok) {
        throw new Error(`os/cpu selection wrong: got [${present.join(', ')}], expected [${expected.join(', ')}]`)
      }

      process.stdout.write('\n✔ Tier 2 OK: only the host platform package was installed; nothing published to npmjs.com.\n')
    } finally {
      await rm(proj, {recursive: true, force: true})
    }
  } finally {
    await registry.teardown()
  }
}

main().catch((error) => {
  process.stderr.write(`\nverdaccio verify failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
