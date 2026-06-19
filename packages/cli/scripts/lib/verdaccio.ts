import { type ChildProcess, execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { repoRoot } from "./platforms.js";

const execFileAsync = promisify(execFile);

/**
 * An ephemeral, **strictly local** Verdaccio registry for the Tier 2 verification
 * (issue #14). It reproduces the one thing Tier 1 cannot: npm's real os/cpu
 * optional-dependency *selection* when installing `keyshelf` from a registry.
 *
 * Safety: none of OUR packages may ever reach npmjs.com. The registry binds to
 * `127.0.0.1` on an ephemeral port; `keyshelf` and `@keyshelf/*` are configured
 * local-only with no uplink proxy (so they can neither be fetched from nor pushed
 * to the public registry), while keyshelf's third-party runtime deps are fetched
 * read-only through an npmjs uplink so the install resolves. Every publish/install
 * carries an explicit `--registry=http://127.0.0.1:<port>` plus an isolated
 * `userconfig` so a stray global `.npmrc` cannot redirect traffic. `npm publish`
 * always targets the local registry, so the uplink is read-only in practice.
 */
export interface VerdaccioRegistry {
  /** Base URL, always `http://127.0.0.1:<port>`. */
  readonly url: string;
  /** Absolute path to the throwaway npm userconfig pinned to this registry. */
  readonly userconfig: string;
  /** A clean env for npm commands that publish/install against this registry only. */
  npmEnv(extra?: Record<string, string>): NodeJS.ProcessEnv;
  /** Stop Verdaccio and remove its working directory. */
  teardown(): Promise<void>;
}

/** Find a free TCP port on the loopback interface. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr === null || typeof addr === "string") {
        reject(new Error("could not determine a free port"));
        return;
      }

      const { port } = addr;
      srv.close(() => resolve(port));
    });
  });
}

/** Resolve the verdaccio CLI entry from the repo's devDependencies. */
function verdaccioBin(): string {
  const candidates = [
    path.join(repoRoot, "node_modules", ".bin", "verdaccio"),
    path.join(repoRoot, "node_modules", "verdaccio", "bin", "verdaccio")
  ];
  const found = candidates.find((c) => existsSync(c));
  if (found === undefined) {
    throw new Error("verdaccio is not installed; add it as a devDependency (npm i -D verdaccio).");
  }

  return found;
}

/** Poll the registry until it answers, or throw after `timeoutMs`. */
async function waitForUp(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/-/ping`);
      if (res.ok || res.status === 404) return; // 404 still means the HTTP server is up
    } catch {
      // not up yet
    }

    await new Promise((r) => setTimeout(r, 250));
  }

  throw new Error(`Verdaccio did not become ready at ${url} within ${timeoutMs}ms`);
}

/**
 * Start an ephemeral Verdaccio. The config disables all uplinks (no public
 * fallback) and allows anonymous publish to any package, so the five platform
 * packages + keyshelf can be published and re-installed entirely offline.
 */
export async function startVerdaccio(): Promise<VerdaccioRegistry> {
  const workDir = await mkdtemp(path.join(os.tmpdir(), "keyshelf-verdaccio-"));
  const storage = path.join(workDir, "storage");
  const configPath = path.join(workDir, "config.yaml");
  const userconfig = path.join(workDir, ".npmrc");
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;

  // Safety model: keyshelf and every @keyshelf/* package are served **only** from
  // local storage with NO uplink proxy — they can never be fetched from, or
  // leaked to, npmjs.com. keyshelf's third-party runtime deps (@oclif/core, yaml,
  // …) are fetched read-only through the npmjs uplink so the install can resolve
  // them. `npm publish` always targets the explicit local --registry, so the
  // uplink is read-only in practice: nothing of ours is ever pushed upstream.
  const config = [
    `storage: ${storage}`,
    // Each platform package carries a ~30-50MB sops binary; raise the body limit
    // well above Verdaccio's 10mb default so `npm publish` is not rejected (413).
    "max_body_size: 200mb",
    "auth:",
    "  htpasswd:",
    `    file: ${path.join(workDir, "htpasswd")}`,
    "    max_users: -1",
    "uplinks:",
    "  npmjs:",
    "    url: https://registry.npmjs.org/",
    "    cache: false",
    "packages:",
    // Our own packages: local-only, no proxy. Publishable, never proxied upstream.
    "  'keyshelf':",
    "    access: $all",
    "    publish: $all",
    "    unpublish: $all",
    "  '@keyshelf/*':",
    "    access: $all",
    "    publish: $all",
    "    unpublish: $all",
    // Everything else (third-party deps) is read-only via the npmjs uplink.
    "  '**':",
    "    access: $all",
    "    publish: $all",
    "    proxy: npmjs",
    "log:",
    "  type: stdout",
    "  format: pretty",
    "  level: warn",
    ""
  ].join("\n");
  await writeFile(configPath, config, "utf8");

  // An npm userconfig pinned to the local registry, with a dummy auth token so
  // `npm publish` is satisfied. Scoped to this registry only.
  await writeFile(
    userconfig,
    [
      `registry=${url}/`,
      `//127.0.0.1:${port}/:_authToken=local-verdaccio-token`,
      "audit=false",
      "fund=false",
      ""
    ].join("\n"),
    "utf8"
  );

  // Bind explicitly to the loopback IPv4 host; Verdaccio otherwise listens on
  // `localhost` (which can resolve to IPv6 ::1) and our 127.0.0.1 probe misses it.
  const child: ChildProcess = spawn(
    process.execPath,
    [verdaccioBin(), "--config", configPath, "--listen", `127.0.0.1:${port}`],
    { cwd: workDir, stdio: "ignore", env: { ...process.env, NODE_ENV: "production" } }
  );
  child.unref();

  try {
    await waitForUp(url);
  } catch (error) {
    child.kill("SIGKILL");
    await rm(workDir, { recursive: true, force: true });
    throw error;
  }

  return {
    url,
    userconfig,
    npmEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
      const env: NodeJS.ProcessEnv = { ...process.env };
      for (const k of Object.keys(env)) {
        if (k === "DEV" || k.startsWith("VITEST") || k.startsWith("npm_")) delete env[k];
      }

      return {
        ...env,
        NODE_ENV: "production",
        // Pin EVERY npm config knob that could redirect traffic to the local registry.
        npm_config_userconfig: userconfig,
        npm_config_registry: `${url}/`,
        ...extra
      };
    },
    async teardown() {
      child.kill("SIGKILL");
      await rm(workDir, { recursive: true, force: true });
    }
  };
}

/** Publish a package directory to a registry, always with an explicit local --registry. */
export async function publishToRegistry(
  pkgDir: string,
  registry: VerdaccioRegistry
): Promise<void> {
  await execFileAsync(
    "npm",
    ["publish", "--registry", `${registry.url}/`, "--userconfig", registry.userconfig],
    {
      cwd: pkgDir,
      env: registry.npmEnv(),
      maxBuffer: 64 * 1024 * 1024
    }
  );
}
