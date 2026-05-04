import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { CLI, TSX } from "./helpers/cli.js";
import {
  setupAgeFixtureDir,
  writeEnvKeyshelf,
  writeKeyshelfConfig,
  type AgeFixturePaths
} from "./helpers/fixture.js";

async function writeBaseFixture(root: string) {
  await writeKeyshelfConfig(root, [
    `name: "demo",`,
    `envs: ["dev", "production"],`,
    `keys: {`,
    `  db: {`,
    `    host: config({ default: "localhost", values: { production: "prod-db" } }),`,
    `    port: 5432,`,
    `  },`,
    `},`
  ]);
  await writeEnvKeyshelf(root, ["DB_HOST=db/host", "DB_PORT=db/port"]);
}

async function writeGroupFixture(root: string): Promise<AgeFixturePaths> {
  const paths = await setupAgeFixtureDir(root);
  await writeKeyshelfConfig(root, [
    `name: "demo",`,
    `envs: ["dev"],`,
    `groups: ["app", "ci"],`,
    `keys: {`,
    `  app: {`,
    `    host: config({ group: "app", value: "localhost" }),`,
    `  },`,
    `  ci: {`,
    `    token: secret({ group: "ci", value: age({ identityFile: ${JSON.stringify(paths.identityFile)}, secretsDir: ${JSON.stringify(paths.secretsDir)} }) }),`,
    `  },`,
    `},`
  ]);
  await writeEnvKeyshelf(root, ["APP_HOST=app/host", "CI_TOKEN=ci/token"]);
  return paths;
}

describe("keyshelf-next run", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "keyshelf-run-"));
    await writeBaseFixture(root);
  });

  it("injects env vars from config defaults when no --env is given", () => {
    const result = execFileSync(
      TSX,
      [
        CLI,
        "run",
        "--",
        "node",
        "-e",
        "console.log(JSON.stringify({h: process.env.DB_HOST, p: process.env.DB_PORT}))"
      ],
      { cwd: root, encoding: "utf-8" }
    );
    expect(JSON.parse(result.trim())).toEqual({ h: "localhost", p: "5432" });
  });

  it("uses values[env] override when --env is provided", () => {
    const result = execFileSync(
      TSX,
      [CLI, "run", "--env", "production", "--", "node", "-e", "console.log(process.env.DB_HOST)"],
      { cwd: root, encoding: "utf-8" }
    );
    expect(result.trim()).toBe("prod-db");
  });

  it("forwards child exit code", () => {
    try {
      execFileSync(TSX, [CLI, "run", "--", "node", "-e", "process.exit(42)"], {
        cwd: root,
        encoding: "utf-8",
        stdio: "pipe"
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as { status: number }).status).toBe(42);
    }
  });

  it("rejects unknown --env with a top-level error", () => {
    try {
      execFileSync(TSX, [CLI, "run", "--env", "staging", "--", "echo", "hi"], {
        cwd: root,
        encoding: "utf-8",
        stdio: "pipe"
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as { stderr: string }).stderr).toContain('Unknown env "staging"');
    }
  });
});

describe("keyshelf-next run (groups)", () => {
  let root: string;
  let identityFile: string;
  let secretsDir: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "keyshelf-run-groups-"));
    const fixture = await writeGroupFixture(root);
    identityFile = fixture.identityFile;
    secretsDir = fixture.secretsDir;

    execFileSync(TSX, [CLI, "set", "--env", "dev", "--value", "ci-secret-value", "ci/token"], {
      cwd: root,
      encoding: "utf-8"
    });
    expect(identityFile).toContain(root);
    expect(secretsDir).toContain(root);
  });

  it("--group app skips ci/token mapping with stderr warning naming the active filter", () => {
    const result = spawnSync(
      TSX,
      [
        CLI,
        "run",
        "--env",
        "dev",
        "--group",
        "app",
        "--",
        "node",
        "-e",
        "console.log(JSON.stringify({h: process.env.APP_HOST ?? null, t: process.env.CI_TOKEN ?? null}))"
      ],
      { cwd: root, encoding: "utf-8" }
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({ h: "localhost", t: null });
    expect(result.stderr).toContain(
      "keyshelf: skipping CI_TOKEN — referenced key 'ci/token' is filtered out by --group=app"
    );
  });

  it("--group ci resolves the secret", () => {
    const result = execFileSync(
      TSX,
      [
        CLI,
        "run",
        "--env",
        "dev",
        "--group",
        "ci",
        "--",
        "node",
        "-e",
        "console.log(process.env.CI_TOKEN)"
      ],
      { cwd: root, encoding: "utf-8" }
    );
    expect(result.trim()).toBe("ci-secret-value");
  });
});
