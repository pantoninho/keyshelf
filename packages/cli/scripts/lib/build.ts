import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type PlatformKey,
  type SopsManifest,
  binaryName,
  platformPackageJson,
  repoRoot
} from "./platforms.js";

/**
 * The supply-chain-critical half of the platform build: fetch each pinned sops
 * binary, **verify its SHA256 against the committed manifest before it is ever
 * written into a package**, smoke-test `sops --version` on it, and assemble the
 * `platforms/sops-{platform}-{arch}/` package directory (`bin/sops[.exe]`,
 * derived package.json, sops's MPL-2.0 LICENSE). A tampered or mismatched binary
 * fails the build here, not at the user's install (ADR-0003 integrity promise).
 */

/** Directory the downloaded release assets are cached in (gitignored). */
const cacheDir = path.join(repoRoot, ".cache", "sops-binaries");
/** Where the assembled platform packages are written. */
const platformsDir = path.join(repoRoot, "platforms");
/** The committed sops MPL-2.0 license text, copied into every package. */
const sopsLicensePath = path.join(repoRoot, "scripts", "assets", "sops-LICENSE");

/** Lowercase hex SHA256 of a buffer. */
export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Assert a downloaded binary's bytes hash to the committed digest. This is the
 * gate that makes a tampered/substituted binary fail the build rather than ship.
 */
export function verifySha256(buf: Buffer, expected: string, label: string): void {
  const actual = sha256(buf);
  if (actual !== expected.toLowerCase()) {
    throw new Error(
      `Integrity check failed: checksum mismatch for ${label}.\n  expected ${expected}\n  actual   ${actual}\n` +
        `Refusing to package an unverified binary.`
    );
  }
}

/** The download URL for one platform's pinned asset. */
function assetUrl(key: PlatformKey, manifest: SopsManifest): string {
  return `https://github.com/getsops/sops/releases/download/${manifest.tag}/${manifest.binaries[key].asset}`;
}

/**
 * Fetch a platform's sops binary (cached by asset name so the test suite never
 * re-downloads), verify its checksum, and return the verified bytes. The cache
 * file is only trusted after it re-passes the checksum, so a corrupt cache entry
 * cannot poison the build.
 */
export async function downloadBinary(
  key: PlatformKey,
  manifest: SopsManifest,
  opts: { cacheDir?: string; fetchImpl?: typeof fetch } = {}
): Promise<Buffer> {
  const dir = opts.cacheDir ?? cacheDir;
  const entry = manifest.binaries[key];
  const cached = path.join(dir, entry.asset);

  if (existsSync(cached)) {
    const buf = await readFile(cached);
    try {
      verifySha256(buf, entry.sha256, key);
      return buf;
    } catch {
      await rm(cached, { force: true });
    }
  }

  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(assetUrl(key, manifest));
  if (!res.ok) {
    throw new Error(`Failed to download ${assetUrl(key, manifest)}: HTTP ${res.status}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  verifySha256(buf, entry.sha256, key);

  await mkdir(dir, { recursive: true });
  await writeFile(cached, buf);
  return buf;
}

/**
 * Write the `platforms/sops-{key}/` package: the binary at `bin/sops[.exe]`
 * (executable), the derived package.json, and sops's LICENSE. The caller has
 * already checksum-verified `binary`.
 */
export async function assemblePackage(
  key: PlatformKey,
  manifest: SopsManifest,
  binary: Buffer,
  outDir: string
): Promise<void> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(path.join(outDir, "bin"), { recursive: true });

  const binPath = path.join(outDir, "bin", binaryName(key));
  await writeFile(binPath, binary);
  await chmod(binPath, 0o755);

  const pkg = platformPackageJson(key, manifest);
  await writeFile(path.join(outDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n", "utf8");

  await copyFile(sopsLicensePath, path.join(outDir, "LICENSE"));
}

/**
 * Run `sops --version` on a packaged binary and return its stdout. Throws if the
 * binary cannot execute or its reported version does not contain the pinned one,
 * so a wrong-arch or broken binary fails the build. Only run on a binary whose
 * `os`/`cpu` match the host (you cannot exec a foreign-arch binary).
 */
export function smokeTest(binaryPath: string): string {
  const out = execFileSync(binaryPath, ["--version", "--disable-version-check"], {
    encoding: "utf8"
  });
  return out.trim();
}

/** Convenience: the assembled package directory for a platform key. */
export function packageDir(key: PlatformKey): string {
  return path.join(platformsDir, `sops-${key}`);
}
