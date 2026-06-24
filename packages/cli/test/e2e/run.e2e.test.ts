import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTmpDir, removeDir, runKeyshelf } from "./helpers.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BIN = path.join(repoRoot, "bin", "run.js");

let cwd: string;

beforeEach(async () => {
  cwd = await makeTmpDir();
});

afterEach(async () => {
  await removeDir(cwd);
});

async function write(rel: string, contents: string): Promise<void> {
  const full = path.join(cwd, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, contents, "utf8");
}

const CONFIG = `project: myapp
providers:
  local:
    adapter: sops
  store:
    adapter: fake
  bogus:
    adapter: no-such-adapter
`;

const SCHEMA = `keys:
  LOG_LEVEL: info
  REGION: !required
  FEATURE_X: !optional
  EXTRA_SECRET: !optional
  DATABASE_URL: !optional
`;

// A config-only environment: REGION supplied, LOG_LEVEL overrides the default.
const CONFIG_ENV = `provider: local
keys:
  LOG_LEVEL: debug
  REGION: eu-west-1
`;

async function scaffold(): Promise<void> {
  await write(".keyshelf/config.yaml", CONFIG);
  await write(".keyshelf/web/schema.yaml", SCHEMA);
  await write(".keyshelf/web/staging.yaml", CONFIG_ENV);
}

/** Seed the file-backed fake store the `fake` adapter reads (storedName -> value). */
async function seedFakeStore(entries: Record<string, string>): Promise<void> {
  await write(".keyshelf/.fake-store.json", JSON.stringify(entries, null, 2));
}

/**
 * Run `keyshelf run web/staging -- <wrapped...>` and capture the child output.
 * Optionally inject ambient env vars into the keyshelf process (and thus the
 * wrapped command, unless keyshelf manages the key).
 */
async function runWrapped(
  argv: string[],
  opts: { env?: Record<string, string> } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [BIN, ...argv], {
      cwd,
      env: { ...process.env, ...opts.env }
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

// Print one env var via a wrapped node process so we read the CHILD's actual env.
function printEnv(name: string): string[] {
  return [
    "run",
    "web/staging",
    "--",
    "node",
    "-e",
    `process.stdout.write(String(process.env.${name}))`
  ];
}

describe("keyshelf run <shelf>/<stage> -- <cmd>", () => {
  it("injects all resolved config keys as env vars with verbatim names", async () => {
    await scaffold();
    const { code, stdout } = await runWrapped([
      "run",
      "web/staging",
      "--",
      "node",
      "-e",
      "process.stdout.write(JSON.stringify({REGION: process.env.REGION, LOG_LEVEL: process.env.LOG_LEVEL}))"
    ]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ REGION: "eu-west-1", LOG_LEVEL: "debug" });
  });

  it("contributes a schema default for a key the environment omits", async () => {
    await scaffold();
    await write(".keyshelf/web/staging.yaml", "provider: local\nkeys:\n  REGION: eu\n");
    const { code, stdout } = await runWrapped(printEnv("LOG_LEVEL"));
    expect(code).toBe(0);
    expect(stdout).toBe("info");
  });

  it("passes through inherited ambient vars for keys keyshelf does not manage", async () => {
    await scaffold();
    const { code, stdout } = await runWrapped(printEnv("UNMANAGED"), {
      env: { UNMANAGED: "passthrough" }
    });
    expect(code).toBe(0);
    expect(stdout).toBe("passthrough");
  });

  it("overrides a stale ambient var of a managed key (managed wins, not ambient)", async () => {
    await scaffold();
    const { code, stdout } = await runWrapped(printEnv("REGION"), {
      env: { REGION: "STALE-AMBIENT" }
    });
    expect(code).toBe(0);
    expect(stdout).toBe("eu-west-1");
  });

  it("lets --set override the resolved value (highest precedence)", async () => {
    await scaffold();
    const { code, stdout } = await runWrapped([
      "run",
      "web/staging",
      "--set",
      "REGION=from-set",
      "--",
      "node",
      "-e",
      "process.stdout.write(String(process.env.REGION))"
    ]);
    expect(code).toBe(0);
    expect(stdout).toBe("from-set");
  });

  it("accepts repeated --set flags and beats both ambient and resolved", async () => {
    await scaffold();
    const { code, stdout } = await runWrapped(
      [
        "run",
        "web/staging",
        "--set",
        "REGION=r2",
        "--set",
        "NEWKEY=n1",
        "--",
        "node",
        "-e",
        "process.stdout.write(JSON.stringify({REGION: process.env.REGION, NEWKEY: process.env.NEWKEY}))"
      ],
      { env: { REGION: "STALE" } }
    );
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ REGION: "r2", NEWKEY: "n1" });
  });

  it("passes the wrapped command's own flags after -- through untouched", async () => {
    await scaffold();
    // The trailing `--set`/positional belong to the wrapped command, not to
    // keyshelf. `sh -c '...' sh "$@"` makes the child echo its own argv verbatim,
    // proving keyshelf neither consumed nor reinterpreted the flag.
    const { code, stdout } = await runWrapped([
      "run",
      "web/staging",
      "--",
      "sh",
      "-c",
      'printf "%s\\n" "$@"',
      "sh",
      "--set",
      "NOT_FOR_KEYSHELF=1",
      "positional"
    ]);
    expect(code).toBe(0);
    expect(stdout).toBe("--set\nNOT_FOR_KEYSHELF=1\npositional\n");
  });

  it("propagates the wrapped command's exit code", async () => {
    await scaffold();
    const { code } = await runWrapped([
      "run",
      "web/staging",
      "--",
      "node",
      "-e",
      "process.exit(7)"
    ]);
    expect(code).toBe(7);
  });

  it("exits zero when the wrapped command exits zero", async () => {
    await scaffold();
    const { code } = await runWrapped([
      "run",
      "web/staging",
      "--",
      "node",
      "-e",
      "process.exit(0)"
    ]);
    expect(code).toBe(0);
  });

  it("aborts before exec on a validation failure (MISSING_REQUIRED), command never runs", async () => {
    await scaffold();
    await write(".keyshelf/web/staging.yaml", "provider: local\nkeys:\n  LOG_LEVEL: debug\n"); // REGION missing
    const sentinel = path.join(cwd, "ran.txt");
    const { code, stdout } = await runWrapped([
      "run",
      "web/staging",
      "--json",
      "--",
      "node",
      "-e",
      `require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'x')`
    ]);
    expect(code).not.toBe(0);
    expect(JSON.parse(stdout).error.code).toBe("MISSING_REQUIRED");
    // The wrapped command must never have run.
    const { existsSync } = await import("node:fs");
    expect(existsSync(sentinel)).toBe(false);
  });

  it("resolves a !secret through the provider adapter by convention and injects it", async () => {
    await scaffold();
    // Namespace mirrors the registry convention keyshelf__{project}__{shelf}__{stage}.
    await seedFakeStore({ keyshelf__myapp__web__staging__EXTRA_SECRET: "s3cr3t-value" });
    await write(
      ".keyshelf/web/staging.yaml",
      "provider: store\nkeys:\n  REGION: eu\n  EXTRA_SECRET: !secret\n"
    );
    const { code, stdout } = await runWrapped(printEnv("EXTRA_SECRET"));
    expect(code).toBe(0);
    expect(stdout).toBe("s3cr3t-value");
  });

  it("resolves a differently-named foreign value via an explicit { ref } override", async () => {
    await scaffold();
    await seedFakeStore({ "shared-db-url": "postgres://shared/db" });
    await write(
      ".keyshelf/web/staging.yaml",
      "provider: store\nkeys:\n  REGION: eu\n  DATABASE_URL: !secret { ref: shared-db-url }\n"
    );
    const { code, stdout } = await runWrapped(printEnv("DATABASE_URL"));
    expect(code).toBe(0);
    expect(stdout).toBe("postgres://shared/db");
  });

  it("aborts with SECRET_NOT_FOUND when a !secret has no stored value", async () => {
    await scaffold();
    await write(
      ".keyshelf/web/staging.yaml",
      "provider: store\nkeys:\n  REGION: eu\n  EXTRA_SECRET: !secret\n"
    );
    const sentinel = path.join(cwd, "ran.txt");
    const { code, stdout } = await runWrapped([
      "run",
      "web/staging",
      "--json",
      "--",
      "node",
      "-e",
      `require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'x')`
    ]);
    expect(code).not.toBe(0);
    expect(JSON.parse(stdout).error.code).toBe("SECRET_NOT_FOUND");
    const { existsSync } = await import("node:fs");
    expect(existsSync(sentinel)).toBe(false);
  });

  it("aborts with ADAPTER_UNAVAILABLE for a !secret on an unregistered adapter", async () => {
    await scaffold();
    // The `bogus` provider names an adapter no branch in the registry handles.
    await write(
      ".keyshelf/web/staging.yaml",
      "provider: bogus\nkeys:\n  REGION: eu\n  EXTRA_SECRET: !secret\n"
    );
    const { code, stdout } = await runWrapped([
      "run",
      "web/staging",
      "--json",
      "--",
      "node",
      "-e",
      "process.exit(0)"
    ]);
    expect(code).not.toBe(0);
    expect(JSON.parse(stdout).error.code).toBe("ADAPTER_UNAVAILABLE");
  });

  it("reports EXEC_FAILED when the wrapped command cannot be started", async () => {
    await scaffold();
    const { code, stdout } = await runWrapped([
      "run",
      "web/staging",
      "--json",
      "--",
      "this-binary-does-not-exist-keyshelf"
    ]);
    expect(code).not.toBe(0);
    expect(JSON.parse(stdout).error.code).toBe("EXEC_FAILED");
  });

  it("rejects a malformed <shelf>/<stage> argument with MALFORMED_FILE", async () => {
    await scaffold();
    const { code, stdout } = await runKeyshelf(
      ["run", "webstaging", "--json", "--", "node", "-e", "0"],
      { cwd }
    );
    expect(code).not.toBe(0);
    expect(JSON.parse(stdout).error.code).toBe("MALFORMED_FILE");
  });

  it("exposes --help and exits zero", async () => {
    const { code, stdout } = await runKeyshelf(["run", "--help"], { cwd });
    expect(code).toBe(0);
    expect(stdout).toContain("run");
  });

  // Signal forwarding: a SIGTERM (or SIGINT/SIGHUP/SIGQUIT) sent to the keyshelf
  // process alone — not the whole foreground process group — must be relayed to
  // the wrapped child so it can shut down gracefully. This is the container
  // entrypoint / supervised-process path, where the interactive Ctrl-C masking
  // does not apply.
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP", "SIGQUIT"] as const) {
    it(`forwards ${signal} to the wrapped child so it can shut down gracefully`, async () => {
      await scaffold();
      const marker = path.join(cwd, `${signal}.marker`);
      // The child traps the signal, writes a marker, and exits 0. A child that
      // never received the signal would instead run for the full 30s and the
      // test would time out / read no marker.
      const childScript = [
        `process.on(${JSON.stringify(signal)}, () => {`,
        `  require('fs').writeFileSync(${JSON.stringify(marker)}, 'caught');`,
        `  process.exit(0);`,
        `});`,
        // Signal readiness on stdout so the test sends the signal only once the
        // handler is installed, then idle long enough to require forwarding.
        `process.stdout.write('ready');`,
        `setTimeout(() => process.exit(1), 30000);`
      ].join("\n");

      const child = spawn("node", [BIN, "run", "web/staging", "--", "node", "-e", childScript], {
        cwd,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"]
      });

      // Wait until the wrapped child has installed its handler and printed
      // 'ready' on stdout (relayed through keyshelf's inherited stdio).
      await new Promise<void>((resolve, reject) => {
        let out = "";
        child.stdout.on("data", (chunk: Buffer) => {
          out += chunk.toString();
          if (out.includes("ready")) resolve();
        });
        child.on("error", reject);
        child.on("exit", () => {
          if (!out.includes("ready")) reject(new Error("child exited before becoming ready"));
        });
      });

      // Send the signal to the keyshelf process *alone*.
      child.kill(signal);

      const code = await new Promise<number>((resolve) => {
        child.on("exit", (exitCode) => resolve(exitCode ?? -1));
      });

      // The wrapped child caught the signal and shut down gracefully.
      expect(await readFile(marker, "utf8")).toBe("caught");
      // keyshelf propagates the child's own exit status (0 here).
      expect(code).toBe(0);
    });
  }

  it("maps a signal-terminated child to 128 + signum after forwarding", async () => {
    await scaffold();
    // The child installs *no* handler, so the forwarded SIGTERM terminates it.
    // keyshelf must report the conventional 128 + 15 = 143.
    const child = spawn(
      "node",
      [
        BIN,
        "run",
        "web/staging",
        "--",
        "node",
        "-e",
        "process.stdout.write('ready'); setTimeout(() => {}, 30000);"
      ],
      { cwd, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] }
    );

    await new Promise<void>((resolve, reject) => {
      let out = "";
      child.stdout.on("data", (chunk: Buffer) => {
        out += chunk.toString();
        if (out.includes("ready")) resolve();
      });
      child.on("error", reject);
    });

    child.kill("SIGTERM");

    const code = await new Promise<number>((resolve) => {
      child.on("exit", (exitCode) => resolve(exitCode ?? -1));
    });

    expect(code).toBe(143);
  });
});
