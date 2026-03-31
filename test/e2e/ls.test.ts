import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { writeAgeFixture } from "./helpers/age.js";

const CLI = join(import.meta.dirname, "..", "..", "bin", "keyshelf.ts");
const TSX = join(import.meta.dirname, "..", "..", "node_modules", ".bin", "tsx");

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "keyshelf-e2e-ls-"));

  await writeFile(
    join(root, "keyshelf.yaml"),
    [
      "keys:",
      "  db:",
      "    host: localhost",
      "    port: 5432",
      '    password: !secret ""',
      "  auth:",
      "    token: !secret",
      "      optional: true"
    ].join("\n")
  );

  await mkdir(join(root, ".keyshelf"));
  await writeFile(
    join(root, ".keyshelf", "dev.yaml"),
    ["keys:", "  db:", "    host: dev-db"].join("\n")
  );

  await writeFile(
    join(root, ".env.keyshelf"),
    ["DB_HOST=db/host", "DB_PORT=db/port", "DB_PASSWORD=db/password"].join("\n")
  );

  return root;
}

describe("keyshelf ls", () => {
  let root: string;

  beforeAll(async () => {
    root = await createFixture();
  });

  it("lists keys from schema only", () => {
    const result = execFileSync(TSX, [CLI, "ls"], {
      cwd: root,
      encoding: "utf-8"
    });
    const lines = result.trim().split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/db\/host\s+config\s+default: localhost/);
    expect(lines[1]).toMatch(/db\/port\s+config\s+default: 5432/);
    expect(lines[2]).toMatch(/db\/password\s+secret/);
    expect(lines[3]).toMatch(/auth\/token\s+secret\s+\(optional\)/);
  });

  it("lists keys with env source info", () => {
    const result = execFileSync(TSX, [CLI, "ls", "--env", "dev"], {
      cwd: root,
      encoding: "utf-8"
    });
    const lines = result.trim().split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/db\/host\s+config\s+override: dev-db/);
    expect(lines[1]).toMatch(/db\/port\s+config\s+default: 5432/);
    expect(lines[2]).toMatch(/db\/password\s+secret\s+\(missing\)/);
    expect(lines[3]).toMatch(/auth\/token\s+secret\s+\(optional, no value\)/);
  });

  it("--reveal without --env fails", () => {
    try {
      execFileSync(TSX, [CLI, "ls", "--reveal"], {
        cwd: root,
        encoding: "utf-8",
        stdio: "pipe"
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as { stderr: string }).stderr).toContain("--reveal requires --env");
    }
  });

  it("fails for missing environment", () => {
    try {
      execFileSync(TSX, [CLI, "ls", "--env", "staging"], {
        cwd: root,
        encoding: "utf-8",
        stdio: "pipe"
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as { stderr: string }).stderr).toContain("Environment file not found");
    }
  });
});

describe("keyshelf ls (age)", () => {
  let root: string;
  const envName = "age-test";

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "keyshelf-e2e-age-ls-"));
    await writeAgeFixture(root, envName);

    execFileSync(
      TSX,
      [
        CLI,
        "set",
        "--env",
        envName,
        "--provider",
        "age",
        "--value",
        "age-secret-value",
        "db/password"
      ],
      { cwd: root, encoding: "utf-8" }
    );
  });

  it("shows provider source for age secrets", () => {
    const result = execFileSync(TSX, [CLI, "ls", "--env", envName], {
      cwd: root,
      encoding: "utf-8"
    });
    const lines = result.trim().split("\n");
    expect(lines[0]).toMatch(/db\/host\s+config\s+override: prod-db/);
    expect(lines[1]).toMatch(/db\/password\s+secret\s+provider: age/);
  });

  it("--reveal resolves and shows actual values", () => {
    const result = execFileSync(TSX, [CLI, "ls", "--env", envName, "--reveal"], {
      cwd: root,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    const lines = result.trim().split("\n");
    expect(lines[0]).toMatch(/db\/host\s+config\s+prod-db/);
    expect(lines[1]).toMatch(/db\/password\s+secret\s+age-secret-value/);
  });
});

describe("keyshelf ls --reveal (cache)", () => {
  let root: string;
  const envName = "cache-test";

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "keyshelf-e2e-cache-ls-"));
    await writeAgeFixture(root, envName, { cacheTtl: 3600 });

    execFileSync(
      TSX,
      [
        CLI,
        "set",
        "--env",
        envName,
        "--provider",
        "age",
        "--value",
        "cached-reveal-secret",
        "db/password"
      ],
      { cwd: root, encoding: "utf-8" }
    );
  });

  it("populates cache on --reveal and serves from it afterwards", async () => {
    // first reveal populates cache
    execFileSync(TSX, [CLI, "ls", "--env", envName, "--reveal"], {
      cwd: root,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    });

    expect(existsSync(join(root, ".keyshelf", "cache", envName, "db_password.age"))).toBe(true);

    // delete the secret source
    await rm(join(root, ".keyshelf", "secrets"), { recursive: true, force: true });

    // second reveal should still work from cache
    const result = execFileSync(TSX, [CLI, "ls", "--env", envName, "--reveal"], {
      cwd: root,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    const lines = result.trim().split("\n");
    expect(lines[1]).toMatch(/db\/password\s+secret\s+cached-reveal-secret/);
  });
});
