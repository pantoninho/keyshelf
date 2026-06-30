import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { packageDir } from "../../scripts/lib/build.js";
import {
  hostPlatformKey,
  platforms,
  type PlatformKey,
  repoRoot
} from "../../scripts/lib/platforms.js";

const execFileAsync = promisify(execFile);

/**
 * Shared scaffolding for the no-publish verification tiers. Both tiers need: a
 * built host platform package (Tier 1 + Tier 2), `npm pack` tarballs, and a
 * hermetic sops project (age key + `.sops.yaml`) so a real `keyshelf run`
 * decrypts through whichever sops the resolver picked. None of this ever touches
 * the public npm registry.
 */

/** Whether age-keygen is resolvable (needed to build the hermetic sops fixture). */
export function ageAvailable(): boolean {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", ["age-keygen"], {
      stdio: "ignore"
    });
    return true;
  } catch {
    return false;
  }
}

/** The host's platform key, asserting it is one we support (it always is in CI/dev). */
export function requireHostKey(): PlatformKey {
  const key = hostPlatformKey();
  if (key === undefined) throw new Error(`Unsupported host ${process.platform}-${process.arch}`);
  return key;
}

/** True once `npm run platforms:build` has produced the host package directory. */
function hostPackageBuilt(): boolean {
  return existsSync(path.join(packageDir(requireHostKey()), "package.json"));
}

/** Ensure the host platform package is built (downloads + verifies once, cached). */
export async function ensureHostPackageBuilt(): Promise<void> {
  if (hostPackageBuilt()) return;
  await execFileAsync("npx", ["tsx", "scripts/build-platforms.ts", "--host"], { cwd: repoRoot });
}

/** True once all five platform package directories have been generated. */
function allPackagesBuilt(): boolean {
  return platforms.every((key) => existsSync(path.join(packageDir(key), "package.json")));
}

/**
 * Ensure all five platform packages are built (Tier 2 needs every binary so npm
 * can pick the host's from a full set). Downloads are cached by the generator, so
 * this fetches each ~30-50MB binary once and reuses it across runs.
 */
export async function ensureAllPackagesBuilt(): Promise<void> {
  if (allPackagesBuilt()) return;
  await execFileAsync("npx", ["tsx", "scripts/build-platforms.ts"], {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024
  });
}

/** Whether the verdaccio CLI is installed (the Tier 2 local registry). */
export function verdaccioInstalled(): boolean {
  return (
    existsSync(path.join(repoRoot, "node_modules", ".bin", "verdaccio")) ||
    existsSync(path.join(repoRoot, "node_modules", "verdaccio", "bin", "verdaccio"))
  );
}

/**
 * `npm pack` a directory into `destDir`, returning the absolute tarball path.
 * The package's own `prepack` (a full build) prints to stdout, so we cannot rely
 * on `--json`; instead we read the single `.tgz` filename npm emits on stdout.
 */
export async function npmPack(srcDir: string, destDir: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "npm",
    ["pack", "--pack-destination", destDir, "--silent", srcDir],
    {
      cwd: repoRoot,
      maxBuffer: 64 * 1024 * 1024,
      // keyshelf's `prepack` runs `oclif manifest`, which records *source*
      // (`src/**.ts`) command paths under a non-production NODE_ENV (vitest sets
      // NODE_ENV=test in this worker). The published tarball ships only `dist`, so
      // a src-referencing manifest makes the installed CLI fail to load commands.
      // Pin production so the manifest references the compiled `dist/**.js` — the
      // shape a real publish produces.
      env: productionEnv()
    }
  );
  const file = stdout
    .split("\n")
    .map((l) => l.trim())
    .reverse()
    .find((l) => l.endsWith(".tgz"));
  if (file === undefined)
    throw new Error(`npm pack of ${srcDir} produced no .tgz line:\n${stdout}`);
  return path.join(destDir, file);
}

/** List a tarball's file paths (relative to its `package/` root). */
export function tarballEntries(tarball: string): string[] {
  const out = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" });
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^package\//, ""));
}

/** Read a JSON file inside a tarball without extracting to disk. */
export function tarballPackageJson(tarball: string): Record<string, unknown> {
  const out = execFileSync("tar", ["-xzO", "-f", tarball, "package/package.json"], {
    encoding: "utf8"
  });
  return JSON.parse(out) as Record<string, unknown>;
}

export async function makeTmpDir(prefix = "keyshelf-platforms-"): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/**
 * Provision a hermetic sops project in `dir`: a throwaway age keypair and a
 * fixture `.sops.yaml` plus a minimal keyshelf project (config.yaml, schema,
 * environment). Returns the age key file path. The same scaffold both tiers use
 * to run a real `keyshelf run` that decrypts through the bundled binary.
 */
export async function scaffoldSopsProject(dir: string): Promise<{ ageKeyFile: string }> {
  const ageKeyFile = path.join(dir, "age-key.txt");
  const { stderr } = await execFileAsync("age-keygen", ["-o", ageKeyFile]);
  const match = /public key:\s*(age1[0-9a-z]+)/i.exec(stderr);
  if (match === null) throw new Error(`could not parse age public key: ${stderr}`);
  const recipient = match[1];

  await writeFile(
    path.join(dir, ".sops.yaml"),
    `creation_rules:\n  - path_regex: secrets/.*\\.yaml$\n    age: ${recipient}\n`,
    "utf8"
  );

  return { ageKeyFile };
}

/**
 * A clean environment for spawning an *installed* keyshelf, as a real user would.
 * Vitest sets `DEV=1`/`NODE_ENV` in its worker, and oclif treats a non-production
 * `NODE_ENV` as a TypeScript dev project — loading commands from `src/*.ts`
 * (which the published tarball does not ship) instead of `dist/*.js`. Stripping
 * those and pinning `NODE_ENV=production` makes the child behave like a genuine
 * `npm i -g keyshelf` install, which is exactly what these tiers verify.
 */
export function productionEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) {
    // Vitest's `DEV`/`VITEST*` flip oclif into dev mode. The `npm_*` lifecycle
    // vars (leaked because the suite is launched via npm/npx from the keyshelf
    // *source* worktree) point oclif's project-root resolution back at this
    // repo — which has a tsconfig.json + src/ — so the installed keyshelf
    // transpiles from `src` instead of `dist`. A genuine `npm i -g keyshelf`
    // user has none of these; strip them so the child behaves like one.
    if (k === "DEV" || k.startsWith("VITEST") || k.startsWith("npm_")) delete env[k];
  }
  env.NODE_ENV = "production";
  return { ...env, ...overrides };
}
