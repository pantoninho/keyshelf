import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { CLI, TSX } from "./helpers/cli.js";
import { setupAgeFixtureDir, writeEnvKeyshelf, writeKeyshelfConfig } from "./helpers/fixture.js";

async function writeFixture(root: string) {
  const { identityFile, secretsDir } = await setupAgeFixtureDir(root);
  await writeKeyshelfConfig(root, [
    `name: "demo",`,
    `envs: ["dev"],`,
    `keys: {`,
    `  db: {`,
    `    host: config({ default: "localhost" }),`,
    `    password: secret({ value: age({ identityFile: ${JSON.stringify(identityFile)}, secretsDir: ${JSON.stringify(secretsDir)} }) }),`,
    `  },`,
    `},`
  ]);
  await writeEnvKeyshelf(root, ["DB_HOST=db/host", "DB_PASSWORD=db/password"]);
}

describe("keyshelf-next set", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "keyshelf-set-"));
    await writeFixture(root);
  });

  it("stores secret via the bound provider and run reads it back", () => {
    execFileSync(TSX, [CLI, "set", "--env", "dev", "--value", "stored-pw", "db/password"], {
      cwd: root,
      encoding: "utf-8"
    });

    const result = execFileSync(
      TSX,
      [CLI, "run", "--env", "dev", "--", "node", "-e", "console.log(process.env.DB_PASSWORD)"],
      { cwd: root, encoding: "utf-8" }
    );
    expect(result.trim()).toBe("stored-pw");
  });

  it("rejects setting a config key", () => {
    try {
      execFileSync(TSX, [CLI, "set", "--env", "dev", "--value", "x", "db/host"], {
        cwd: root,
        encoding: "utf-8",
        stdio: "pipe"
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as { stderr: string }).stderr).toContain("keyshelf does not write config values");
    }
  });

  it("rejects unknown key", () => {
    try {
      execFileSync(TSX, [CLI, "set", "--env", "dev", "--value", "x", "does/not/exist"], {
        cwd: root,
        encoding: "utf-8",
        stdio: "pipe"
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as { stderr: string }).stderr).toContain('"does/not/exist" is not defined');
    }
  });

  it("reads value from stdin pipe when --value is omitted", () => {
    execFileSync(TSX, [CLI, "set", "--env", "dev", "db/password"], {
      cwd: root,
      encoding: "utf-8",
      input: "piped-pw\n"
    });

    const result = execFileSync(
      TSX,
      [CLI, "run", "--env", "dev", "--", "node", "-e", "console.log(process.env.DB_PASSWORD)"],
      { cwd: root, encoding: "utf-8" }
    );
    expect(result.trim()).toBe("piped-pw");
  });
});
