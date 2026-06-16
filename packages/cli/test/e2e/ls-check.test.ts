import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { CLI, TSX } from "./helpers/cli.js";
import { setupAgeFixtureDir, writeEnvKeyshelf, writeKeyshelfConfig } from "./helpers/fixture.js";

// Each test spawns at least one tsx subprocess; cold-start adds up on CI, so
// give the whole file plenty of headroom over the 5s default.
const SPAWN_TIMEOUT = 30_000;

interface ExecResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runCheck(args: string[], cwd: string): ExecResult {
  try {
    const stdout = execFileSync(TSX, [CLI, "ls", "--check", ...args], {
      cwd,
      encoding: "utf-8",
      stdio: ["inherit", "pipe", "pipe"]
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { status: e.status, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

async function writeFixture(root: string) {
  const { identityFile, secretsDir } = await setupAgeFixtureDir(root);
  const age = `age({ identityFile: ${JSON.stringify(identityFile)}, secretsDir: ${JSON.stringify(secretsDir)} })`;
  await writeKeyshelfConfig(root, [
    `name: "demo",`,
    `envs: ["dev", "production"],`,
    `groups: ["app", "ci"],`,
    `keys: {`,
    `  db: {`,
    `    host: config({ group: "app", default: "localhost", values: { production: "prod-db" } }),`,
    `    password: secret({ group: "app", value: ${age} }),`,
    `  },`,
    `  ci: {`,
    `    token: secret({ group: "ci", value: ${age} }),`,
    `  },`,
    // Required config key with a dev-only binding and no fallback: resolving it
    // for production must fail with a "no value for required key" cause.
    `  apiUrl: config({ group: "app", values: { dev: "https://dev.example" } }),`,
    `  optionalThing: secret({ group: "app", optional: true, value: ${age} }),`,
    `},`
  ]);
  // App mapping only references db/host — the sweep must ignore this and check
  // db/password, ci/token, optionalThing regardless.
  await writeEnvKeyshelf(root, ["DB_HOST=db/host"]);
}

function setSecret(root: string, env: string, keyPath: string, value: string) {
  execFileSync(TSX, [CLI, "set", "--env", env, "--value", value, keyPath], {
    cwd: root,
    encoding: "utf-8"
  });
}

// Read-only sweeps against a fully-seeded fixture. Seeding once in beforeAll
// keeps each test to a single spawn so the suite stays well under timeout.
describe("keyshelf ls --check (seeded)", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "keyshelf-ls-check-seeded-"));
    await writeFixture(root);
    setSecret(root, "dev", "db/password", "host-pw");
    setSecret(root, "dev", "ci/token", "ci-pw");
  }, SPAWN_TIMEOUT);

  it(
    "exits 0 when every required key resolves (optional unresolved is fine)",
    () => {
      const result = runCheck(["--env", "dev"], root);
      expect(result.status).toBe(0);
    },
    SPAWN_TIMEOUT
  );

  it(
    "reports optional unresolved keys as skipped, not failures",
    () => {
      // optionalThing is never seeded -> skipped, but the sweep still exits 0.
      const result = runCheck(["--env", "dev"], root);
      expect(result.status).toBe(0);
      expect(result.stdout + result.stderr).toMatch(/optionalThing|optional/);
    },
    SPAWN_TIMEOUT
  );

  it(
    "excludes an env-scoped key from an env outside its values (N/A)",
    () => {
      // apiUrl is env-scoped (dev-only binding, no fallback), so it is N/A in
      // production: excluded from the sweep entirely — no FAIL, no SKIP line,
      // never even mentioned. Secrets are envless storage seeded for dev, which
      // satisfies production too, so the whole sweep passes.
      const result = runCheck(["--env", "production"], root);
      expect(result.status).toBe(0);
      expect(result.stdout + result.stderr).not.toContain("apiUrl");
    },
    SPAWN_TIMEOUT
  );
});

describe("keyshelf ls --check (unseeded)", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "keyshelf-ls-check-unseeded-"));
    await writeFixture(root);
  }, SPAWN_TIMEOUT);

  it(
    "validates keys that no app mapping references",
    () => {
      // db/password and ci/token are unmapped but required, and unseeded.
      const result = runCheck(["--env", "dev"], root);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("db/password");
      expect(result.stderr).toContain("ci/token");
    },
    SPAWN_TIMEOUT
  );

  it(
    "surfaces a provider not-found cause without leaking values",
    () => {
      const result = runCheck(["--env", "dev"], root);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("db/password");
      expect(result.stderr.toLowerCase()).toMatch(/not found/);
    },
    SPAWN_TIMEOUT
  );

  it(
    "requires --env",
    () => {
      const result = runCheck([], root);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("--env");
    },
    SPAWN_TIMEOUT
  );

  it(
    "rejects an unknown env",
    () => {
      const result = runCheck(["--env", "nope"], root);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("nope");
    },
    SPAWN_TIMEOUT
  );
});

// A failing sweep must never print a seeded secret's value. Kept separate
// because it seeds a value we then assert is absent from output.
describe("keyshelf ls --check (no value leak)", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "keyshelf-ls-check-leak-"));
    await writeFixture(root);
    // Seed only ci/token; db/password stays unseeded so the sweep fails.
    setSecret(root, "dev", "ci/token", "the-secret-value");
  }, SPAWN_TIMEOUT);

  it(
    "never prints a resolved secret value in its report",
    () => {
      const result = runCheck(["--env", "dev"], root);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("db/password");
      expect(result.stderr).not.toContain("the-secret-value");
      expect(result.stdout).not.toContain("the-secret-value");
    },
    SPAWN_TIMEOUT
  );
});
