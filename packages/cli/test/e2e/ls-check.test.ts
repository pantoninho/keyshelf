import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { CLI, TSX } from "./helpers/cli.js";
import { setupAgeFixtureDir, writeEnvKeyshelf, writeKeyshelfConfig } from "./helpers/fixture.js";

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
  return { identityFile, secretsDir };
}

function seedAll(root: string) {
  execFileSync(TSX, [CLI, "set", "--env", "dev", "--value", "host-pw", "db/password"], {
    cwd: root,
    encoding: "utf-8"
  });
  execFileSync(TSX, [CLI, "set", "--env", "dev", "--value", "ci-pw", "ci/token"], {
    cwd: root,
    encoding: "utf-8"
  });
}

describe("keyshelf ls --check", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "keyshelf-ls-check-"));
    await writeFixture(root);
  });

  it("exits 0 when every required key resolves (optional unresolved is fine)", () => {
    seedAll(root);
    const result = runCheck(["--env", "dev"], root);
    expect(result.status).toBe(0);
  });

  it("validates keys that no app mapping references", () => {
    // Nothing seeded: db/password and ci/token are unmapped but required.
    const result = runCheck(["--env", "dev"], root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("db/password");
    expect(result.stderr).toContain("ci/token");
  });

  it("reports failing keys with a cause and never the secret value", () => {
    // Seed only ci/token; db/password stays unseeded.
    execFileSync(TSX, [CLI, "set", "--env", "dev", "--value", "the-secret", "ci/token"], {
      cwd: root,
      encoding: "utf-8"
    });
    const result = runCheck(["--env", "dev"], root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("db/password");
    expect(result.stderr.toLowerCase()).toMatch(/not[ _-]?found|no binding|could not/);
    expect(result.stderr).not.toContain("the-secret");
  });

  it("distinguishes no binding for env from a provider error", () => {
    // Secrets are envless storage, so seeding for dev satisfies production too.
    // What stays unresolvable for production is apiUrl: required, dev-only
    // binding, no fallback => "no value for required key" (a binding gap, not a
    // provider error).
    seedAll(root);
    const result = runCheck(["--env", "production"], root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("apiUrl");
    expect(result.stderr.toLowerCase()).toMatch(/no value|required/);
  });

  it("surfaces a provider error cause for an unseeded required secret", () => {
    // Nothing seeded; db/password is required and its provider file is absent.
    const result = runCheck(["--env", "dev"], root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("db/password");
    expect(result.stderr.toLowerCase()).toMatch(/not found/);
  });

  it("reports optional unresolved keys as skipped, not failures", () => {
    seedAll(root);
    const result = runCheck(["--env", "dev"], root);
    // optionalThing is never seeded -> skipped, still exit 0
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/optionalThing|optional/);
  });

  it("requires --env", () => {
    const result = runCheck([], root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--env");
  });

  it("rejects an unknown env", () => {
    const result = runCheck(["--env", "nope"], root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("nope");
  });
});
