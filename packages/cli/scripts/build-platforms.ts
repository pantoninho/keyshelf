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
import process from "node:process";
import { assemblePackage, downloadBinary, packageDir, smokeTest } from "./lib/build.js";
import {
  hostPlatformKey,
  loadSopsManifest,
  platforms,
  type SopsManifest,
  type PlatformKey
} from "./lib/platforms.js";

/** The host's platform key, or a hard error when this machine has no bundled sops package. */
function requireHost(): PlatformKey {
  const host = hostPlatformKey();
  if (host === undefined) {
    throw new Error(
      `Unsupported host ${process.platform}-${process.arch}; no bundled sops package.`
    );
  }

  return host;
}

/** Reject any key that isn't a known platform; returns the keys unchanged when all are valid. */
function assertKnownPlatforms(keys: PlatformKey[]): PlatformKey[] {
  for (const key of keys) {
    if (!(platforms as readonly string[]).includes(key)) {
      throw new Error(`Unknown platform '${key}'. Known: ${platforms.join(", ")}.`);
    }
  }

  return keys;
}

/**
 * Resolve which platform packages this invocation should build from argv:
 * `--host` → just the host's platform; explicit names → those; nothing → all five.
 * Every resolved key is validated against the known platform set before returning.
 */
function resolveTargets(args: string[]): PlatformKey[] {
  if (args.includes("--host")) return [requireHost()];

  const named = args.filter((a) => !a.startsWith("--"));
  return assertKnownPlatforms(named.length > 0 ? (named as PlatformKey[]) : [...platforms]);
}

/** Smoke-test the just-assembled host binary; the only platform this machine can execute. */
function smokeTestHost(key: PlatformKey, out: string, manifest: SopsManifest): void {
  const version = smokeTest(`${out}/bin/${process.platform === "win32" ? "sops.exe" : "sops"}`);
  if (!version.includes(manifest.sopsVersion)) {
    throw new Error(
      `Smoke test failed for ${key}: '${version}' does not report sops ${manifest.sopsVersion}.`
    );
  }
  process.stdout.write(` … smoke-test ok (${version})`);
}

/** Download (checksum-verified), assemble, and — for the host — smoke-test one platform package. */
async function buildPlatform(
  key: PlatformKey,
  manifest: SopsManifest,
  host: PlatformKey | undefined
): Promise<void> {
  process.stdout.write(`• ${key}: downloading ${manifest.binaries[key].asset} … `);
  const binary = await downloadBinary(key, manifest);
  process.stdout.write("checksum ok … ");

  const out = packageDir(key);
  await assemblePackage(key, manifest, binary, out);
  process.stdout.write("packaged");

  if (key === host) {
    smokeTestHost(key, out, manifest);
  }
  process.stdout.write("\n");
}

async function main(): Promise<void> {
  const manifest = loadSopsManifest();
  const targets = resolveTargets(process.argv.slice(2));
  const host = hostPlatformKey();

  for (const key of targets) {
    await buildPlatform(key, manifest, host);
  }

  process.stdout.write(`\nDone. ${targets.length} platform package(s) written to platforms/.\n`);
}

main().catch((error) => {
  process.stderr.write(
    `\nplatforms build failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
