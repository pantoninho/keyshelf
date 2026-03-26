import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { writeAgeFixture } from "./helpers/age.js";

const CLI = join(import.meta.dirname, "..", "..", "bin", "keyshelf.ts");
const TSX = join(import.meta.dirname, "..", "..", "node_modules", ".bin", "tsx");

describe("keyshelf rm (age)", () => {
  let root: string;
  let secretsDir: string;
  const envName = "age-rm-test";

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "keyshelf-e2e-age-rm-"));
    await writeAgeFixture(root, envName);
    secretsDir = join(root, ".keyshelf", "secrets");
  });

  it("removes a secret stored via provider", async () => {
    // First set a secret
    execFileSync(
      TSX,
      [CLI, "set", "--env", envName, "--provider", "age", "--value", "to-delete", "db/password"],
      { cwd: root, encoding: "utf-8" }
    );

    expect(existsSync(join(secretsDir, "db_password.age"))).toBe(true);

    // Now remove it
    const output = execFileSync(TSX, [CLI, "rm", "--env", envName, "db/password"], {
      cwd: root,
      encoding: "utf-8"
    });

    expect(output).toContain("Removed");
    expect(existsSync(join(secretsDir, "db_password.age"))).toBe(false);
  });

  it("removes a plaintext override from env file", async () => {
    const output = execFileSync(TSX, [CLI, "rm", "--env", envName, "db/host"], {
      cwd: root,
      encoding: "utf-8"
    });

    expect(output).toContain("Removed");

    const envContent = await readFile(join(root, ".keyshelf", `${envName}.yaml`), "utf-8");
    expect(envContent).not.toContain("host");
  });

  it("errors when key does not exist", () => {
    expect(() =>
      execFileSync(TSX, [CLI, "rm", "--env", envName, "nonexistent/key"], {
        cwd: root,
        encoding: "utf-8",
        stdio: "pipe"
      })
    ).toThrow();
  });
});
