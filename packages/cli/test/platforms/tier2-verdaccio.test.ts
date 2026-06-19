import {execFile} from 'node:child_process'
import {existsSync} from 'node:fs'
import {readdir, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {promisify} from 'node:util'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {packageDir} from '../../scripts/lib/build.js'
import {osCpu, platforms, repoRoot} from '../../scripts/lib/platforms.js'
import {publishToRegistry, startVerdaccio, type VerdaccioRegistry} from '../../scripts/lib/verdaccio.js'
import {
  ensureAllPackagesBuilt,
  makeTmpDir,
  removeDir,
  requireHostKey,
  verdaccioInstalled,
} from './helpers.js'

const execFileAsync = promisify(execFile)

/**
 * Tier 2 — a *local* Verdaccio registry (still nothing public). Publish all five
 * platform packages + keyshelf to an ephemeral 127.0.0.1 registry, install
 * `keyshelf` from it into a clean dir, and assert npm's real os/cpu selection
 * landed ONLY the host's platform package — the one behaviour Tier 1 cannot
 * prove. The registry has no uplinks and every command carries an explicit local
 * `--registry`, so npmjs.com is never contacted. Torn down at the end.
 *
 * Skips when verdaccio is unavailable so a constrained environment stays green;
 * CI installs it and runs this for real.
 */

const hostKey = requireHostKey()
const run = verdaccioInstalled() ? describe : describe.skip

run('Tier 2: local Verdaccio os/cpu selection', () => {
  let registry: VerdaccioRegistry

  beforeAll(async () => {
    await ensureAllPackagesBuilt()
    registry = await startVerdaccio()
    // Publish all five platform packages, then keyshelf itself.
    for (const key of platforms) {
      await publishToRegistry(packageDir(key), registry)
    }

    await publishToRegistry(repoRoot, registry)
  }, 900_000)

  afterAll(async () => {
    if (registry) await registry.teardown()
  })

  it('publishes only to the local registry (never npmjs.com)', () => {
    expect(registry.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  it('installs keyshelf and lands ONLY the host platform package (others skipped via os/cpu)', async () => {
    const proj = await makeTmpDir('keyshelf-tier2-proj-')
    try {
      await writeFile(
        path.join(proj, 'package.json'),
        JSON.stringify({name: 'tier2-fixture', version: '1.0.0', private: true}, null, 2),
        'utf8',
      )
      // Explicit local registry on the command line AND via the pinned userconfig.
      await execFileAsync(
        'npm',
        ['install', 'keyshelf', '--registry', `${registry.url}/`, '--userconfig', registry.userconfig, '--no-audit', '--no-fund'],
        {cwd: proj, env: registry.npmEnv(), maxBuffer: 64 * 1024 * 1024},
      )

      // keyshelf itself is present and resolvable.
      expect(existsSync(path.join(proj, 'node_modules', 'keyshelf', 'package.json'))).toBe(true)

      // Exactly the host's @keyshelf/sops-* package is installed; the other four
      // were skipped by npm because their os/cpu do not match this host.
      const scopeDir = path.join(proj, 'node_modules', '@keyshelf')
      const present = existsSync(scopeDir) ? (await readdir(scopeDir)).filter((d) => d.startsWith('sops-')) : []
      expect(present).toEqual([`sops-${hostKey}`])

      // The other four platform names are genuinely absent.
      for (const key of platforms) {
        const installed = existsSync(path.join(scopeDir, `sops-${key}`))
        expect(installed, key).toBe(key === hostKey)
      }

      // The one that landed carries the host's os/cpu and its bundled binary.
      const hostPkg = JSON.parse(
        await import('node:fs/promises').then((m) =>
          m.readFile(path.join(scopeDir, `sops-${hostKey}`, 'package.json'), 'utf8'),
        ),
      )
      const {os, cpu} = osCpu(hostKey)
      expect(hostPkg.os).toEqual([os])
      expect(hostPkg.cpu).toEqual([cpu])
      const binFile = hostKey.startsWith('win32-') ? 'sops.exe' : 'sops'
      expect(existsSync(path.join(scopeDir, `sops-${hostKey}`, 'bin', binFile))).toBe(true)
    } finally {
      await removeDir(proj)
    }
  }, 300_000)
})
