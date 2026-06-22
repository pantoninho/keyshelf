import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { packageDir } from "../../scripts/lib/build.js";
import { osCpu, repoRoot } from "../../scripts/lib/platforms.js";
import {
  ageAvailable,
  ensureHostPackageBuilt,
  makeTmpDir,
  npmPack,
  productionEnv,
  removeDir,
  requireHostKey,
  scaffoldSopsProject,
  tarballEntries,
  tarballPackageJson
} from "./helpers.js";

const execFileAsync = promisify(execFile);

/**
 * Tier 1 — no registry at all. Build the host platform package, `npm pack` it,
 * assert the tarball carries the binary + correct os/cpu/license, then install
 * the tarball (and keyshelf itself) into a temp project via a `file:` ref and run
 * a real `keyshelf run` against three resolver states:
 *   1. bundled package installed, `sops` scrubbed from PATH → the BUNDLED binary
 *      is the only thing that can satisfy the resolver, and it decrypts;
 *   2. bundled package absent, a real `sops` on PATH → the PATH fallback decrypts;
 *   3. bundled package absent and PATH scrubbed → structured ADAPTER_UNAVAILABLE.
 * The resolver contract is unchanged. Zero publishing.
 */

const hostKey = requireHostKey();
const binFile = hostKey.startsWith("win32-") ? "sops.exe" : "sops";

describe("Tier 1: npm pack tarball metadata", () => {
  let tarball: string;
  let workDir: string;

  beforeAll(async () => {
    await ensureHostPackageBuilt();
    workDir = await makeTmpDir("keyshelf-tier1-pack-");
    tarball = await npmPack(packageDir(hostKey), workDir);
  }, 300_000);

  afterAll(async () => {
    if (workDir) await removeDir(workDir);
  });

  it("includes the platform binary at bin/sops[.exe]", () => {
    expect(tarballEntries(tarball)).toContain(`bin/${binFile}`);
  });

  it("carries os/cpu matching the package name and the MPL-2.0 license", () => {
    const pkg = tarballPackageJson(tarball);
    const { os, cpu } = osCpu(hostKey);
    expect(pkg.name).toBe(`@keyshelf/sops-${hostKey}`);
    expect(pkg.os).toEqual([os]);
    expect(pkg.cpu).toEqual([cpu]);
    expect(pkg.license).toBe("MPL-2.0");
  });
});

// The end-to-end install+run leg needs age to build the hermetic .sops.yaml.
const e2e = ageAvailable() ? describe : describe.skip;

e2e("Tier 1: file:-installed bundled binary drives a real keyshelf run", () => {
  let proj: string;
  let keyshelfTarball: string;
  let platformTarball: string;
  let packDir: string;

  beforeAll(async () => {
    await ensureHostPackageBuilt();
    packDir = await makeTmpDir("keyshelf-tier1-tgz-");
    // Pack keyshelf (build runs via its prepack) and the host platform package.
    keyshelfTarball = await npmPack(repoRoot, packDir);
    platformTarball = await npmPack(packageDir(hostKey), packDir);
  }, 300_000);

  afterAll(async () => {
    if (proj) await removeDir(proj);
    if (packDir) await removeDir(packDir);
  });

  async function installProject(deps: Record<string, string>): Promise<string> {
    const dir = await makeTmpDir("keyshelf-tier1-proj-");
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify(
        { name: "tier1-fixture", version: "1.0.0", private: true, dependencies: deps },
        null,
        2
      ),
      "utf8"
    );
    // Install only the file: tarballs; never reach the public registry for
    // these. `--omit=optional` keeps keyshelf's now-published `@keyshelf/sops-*`
    // optionalDependencies out of the install, so each leg sees exactly the sops
    // sources it sets up (the file: platform tarball and/or PATH) and nothing
    // leaks in from the registry.
    await execFileAsync("npm", ["install", "--no-audit", "--no-fund", "--omit=optional"], {
      cwd: dir,
      maxBuffer: 64 * 1024 * 1024
    });
    return dir;
  }

  /** A keyshelf project with a !secret, runnable end to end. */
  async function scaffoldKeyshelf(dir: string): Promise<{ ageKeyFile: string }> {
    const out = await scaffoldSopsProject(dir);
    const root = path.join(dir, ".keyshelf");
    await mkdir(path.join(root, "app"), { recursive: true });
    await writeFile(
      path.join(root, "config.yaml"),
      "project: tier1\nproviders:\n  local:\n    adapter: sops\n",
      "utf8"
    );
    await writeFile(path.join(root, "app", "schema.yaml"), "keys:\n  TOKEN: !required\n", "utf8");
    await writeFile(
      path.join(root, "app", "staging.yaml"),
      "provider: local\nkeys:\n  TOKEN: !required\n",
      "utf8"
    );
    return out;
  }

  /** PATH with every dir containing a `sops` removed, so only the bundled binary can satisfy the resolver. */
  function pathWithoutSops(): string {
    const sep = path.delimiter;
    return (process.env.PATH ?? "")
      .split(sep)
      .filter((d) => {
        try {
          return !existsSync(path.join(d, "sops"));
        } catch {
          return true;
        }
      })
      .join(sep);
  }

  /** Run the installed keyshelf binary; never throws on non-zero exit. */
  async function runKeyshelf(
    bin: string,
    args: string[],
    opts: { cwd: string; env: NodeJS.ProcessEnv; input?: string }
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    try {
      const child = execFileAsync(bin, args, {
        cwd: opts.cwd,
        env: opts.env,
        maxBuffer: 64 * 1024 * 1024
      });
      if (opts.input !== undefined) child.child.stdin?.end(opts.input);
      const { stdout, stderr } = await child;
      return { code: 0, stdout, stderr };
    } catch (error) {
      const e = error as { code?: number; stdout?: string; stderr?: string };
      return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }
  }

  it("resolves the bundled binary from the file: install and decrypts a secret (PATH sops scrubbed)", async () => {
    proj = await installProject({
      keyshelf: `file:${keyshelfTarball}`,
      [`@keyshelf/sops-${hostKey}`]: `file:${platformTarball}`
    });
    const { ageKeyFile } = await scaffoldKeyshelf(proj);

    const keyshelfBin = path.join(proj, "node_modules", ".bin", "keyshelf");
    const env = productionEnv({
      SOPS_AGE_KEY_FILE: ageKeyFile,
      PATH: pathWithoutSops(),
      // Belt-and-braces: ensure no override short-circuits the bundled lookup.
      KEYSHELF_SOPS_BIN: ""
    });

    // The bundled binary must be the only resolvable sops (PATH scrubbed).
    const bundled = path.join(proj, "node_modules", "@keyshelf", `sops-${hostKey}`, "bin", binFile);
    expect(existsSync(bundled)).toBe(true);

    // Store a secret (write goes through the bundled sops; value via stdin), then
    // a real `keyshelf run` decrypts and exports it.
    const set = await runKeyshelf(keyshelfBin, ["set", "TOKEN", "app/staging", "--secret"], {
      cwd: proj,
      env,
      input: "s3cr3t"
    });
    expect(set.code, set.stderr).toBe(0);

    const run = await runKeyshelf(keyshelfBin, ["run", "app/staging", "--", "printenv", "TOKEN"], {
      cwd: proj,
      env
    });
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout.trim()).toBe("s3cr3t");
  }, 300_000);

  it("falls back to a PATH sops when the platform package is not installed", async () => {
    // No platform package; a real sops IS on PATH. The resolver must use it and
    // decrypt — proving the PATH fallback leg of the resolver contract.
    const bare = await installProject({ keyshelf: `file:${keyshelfTarball}` });
    try {
      const { ageKeyFile } = await scaffoldKeyshelf(bare);
      const keyshelfBin = path.join(bare, "node_modules", ".bin", "keyshelf");
      // PATH retains sops; no bundled package present.
      const env = productionEnv({ SOPS_AGE_KEY_FILE: ageKeyFile, KEYSHELF_SOPS_BIN: "" });
      const set = await runKeyshelf(keyshelfBin, ["set", "TOKEN", "app/staging", "--secret"], {
        cwd: bare,
        env,
        input: "p4thfallback"
      });
      expect(set.code, set.stderr).toBe(0);
      const run = await runKeyshelf(
        keyshelfBin,
        ["run", "app/staging", "--", "printenv", "TOKEN"],
        { cwd: bare, env }
      );
      expect(run.code, run.stderr).toBe(0);
      expect(run.stdout.trim()).toBe("p4thfallback");
    } finally {
      await removeDir(bare);
    }
  }, 300_000);

  it("surfaces ADAPTER_UNAVAILABLE when neither bundled package nor PATH sops resolves", async () => {
    // Install keyshelf WITHOUT the platform package, and scrub sops from PATH:
    // nothing is resolvable, so the structured error (never a raw spawn) fires.
    const bare = await installProject({ keyshelf: `file:${keyshelfTarball}` });
    try {
      const { ageKeyFile } = await scaffoldKeyshelf(bare);
      const keyshelfBin = path.join(bare, "node_modules", ".bin", "keyshelf");
      const env = productionEnv({
        SOPS_AGE_KEY_FILE: ageKeyFile,
        PATH: pathWithoutSops(),
        KEYSHELF_SOPS_BIN: ""
      });
      const set = await runKeyshelf(keyshelfBin, ["set", "TOKEN", "app/staging", "--secret"], {
        cwd: bare,
        env,
        input: "s3cr3t"
      });
      expect(set.code).not.toBe(0);
      expect(set.stderr).toMatch(/ADAPTER_UNAVAILABLE|No usable 'sops' binary/);
    } finally {
      await removeDir(bare);
    }
  }, 300_000);
});
