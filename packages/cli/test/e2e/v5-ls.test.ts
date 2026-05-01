import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { generateIdentity } from "../../src/providers/age.js";
import { V5_CLI, TSX } from "./helpers/v5-cli.js";

async function writeAgeFixture(root: string) {
  const identityFile = join(root, "key.txt");
  const secretsDir = join(root, ".keyshelf", "secrets");
  await writeFile(identityFile, await generateIdentity());
  await mkdir(secretsDir, { recursive: true });

  await writeFile(
    join(root, "keyshelf.config.ts"),
    [
      `import { defineConfig, config, secret, age } from "keyshelf/config";`,
      ``,
      `export default defineConfig({`,
      `  name: "demo",`,
      `  envs: ["dev", "production"],`,
      `  groups: ["app", "ci"],`,
      `  keys: {`,
      `    db: {`,
      `      host: config({ group: "app", default: "localhost", values: { production: "prod-db" } }),`,
      `      password: secret({ group: "app", value: age({ identityFile: ${JSON.stringify(identityFile)}, secretsDir: ${JSON.stringify(secretsDir)} }) }),`,
      `    },`,
      `    ci: {`,
      `      token: secret({ group: "ci", value: age({ identityFile: ${JSON.stringify(identityFile)}, secretsDir: ${JSON.stringify(secretsDir)} }) }),`,
      `    },`,
      `  },`,
      `});`,
      ``
    ].join("\n")
  );
  await writeFile(
    join(root, ".env.keyshelf"),
    ["DB_HOST=db/host", "DB_PASSWORD=db/password", "CI_TOKEN=ci/token"].join("\n")
  );
}

describe("keyshelf-next ls", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "keyshelf-v5-ls-"));
    await writeAgeFixture(root);
  });

  it("lists schema with kind, group, and source columns", () => {
    const result = execFileSync(TSX, [V5_CLI, "ls"], { cwd: root, encoding: "utf-8" });
    const lines = result.trim().split("\n");
    expect(lines).toEqual([
      expect.stringMatching(/^db\/host\s+config\s+app\s+value: localhost$/),
      expect.stringMatching(/^db\/password\s+secret\s+app\s+provider: age$/),
      expect.stringMatching(/^ci\/token\s+secret\s+ci\s+provider: age$/)
    ]);
  });

  it("uses values[env] override in source description", () => {
    const result = execFileSync(TSX, [V5_CLI, "ls", "--env", "production"], {
      cwd: root,
      encoding: "utf-8"
    });
    expect(result).toMatch(/db\/host\s+config\s+app\s+value: prod-db/);
  });

  it("--group ci marks app keys as filtered", () => {
    const result = execFileSync(TSX, [V5_CLI, "ls", "--group", "ci"], {
      cwd: root,
      encoding: "utf-8"
    });
    expect(result).toMatch(/db\/host\s+\S+\s+app\s+\(filtered\)/);
    expect(result).toMatch(/ci\/token\s+secret\s+ci\s+provider: age/);
  });

  it("--reveal without --env errors", () => {
    try {
      execFileSync(TSX, [V5_CLI, "ls", "--reveal"], {
        cwd: root,
        encoding: "utf-8",
        stdio: "pipe"
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as { stderr: string }).stderr).toContain("--reveal requires --env");
    }
  });
});

describe("keyshelf-next ls (reveal)", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "keyshelf-v5-ls-reveal-"));
    await writeAgeFixture(root);
    execFileSync(TSX, [V5_CLI, "set", "--env", "dev", "--value", "host-pw", "db/password"], {
      cwd: root,
      encoding: "utf-8"
    });
    execFileSync(TSX, [V5_CLI, "set", "--env", "dev", "--value", "ci-pw", "ci/token"], {
      cwd: root,
      encoding: "utf-8"
    });
  });

  it("--reveal --env shows resolved values", () => {
    const result = execFileSync(TSX, [V5_CLI, "ls", "--reveal", "--env", "dev"], {
      cwd: root,
      encoding: "utf-8",
      stdio: ["inherit", "pipe", "pipe"]
    });
    expect(result).toMatch(/db\/host\s+\S+\s+app\s+localhost/);
    expect(result).toMatch(/db\/password\s+secret\s+app\s+host-pw/);
    expect(result).toMatch(/ci\/token\s+secret\s+ci\s+ci-pw/);
  });

  it("--format json --reveal --env --map emits structured vars", () => {
    const result = execFileSync(
      TSX,
      [V5_CLI, "ls", "--reveal", "--env", "dev", "--map", ".env.keyshelf", "--format", "json"],
      { cwd: root, encoding: "utf-8" }
    );
    const parsed = JSON.parse(result);
    expect(parsed).toMatchObject({
      env: "dev",
      vars: [
        { envVar: "DB_HOST", keyPath: "db/host", value: "localhost", secret: false },
        { envVar: "DB_PASSWORD", keyPath: "db/password", value: "host-pw", secret: true },
        { envVar: "CI_TOKEN", keyPath: "ci/token", value: "ci-pw", secret: true }
      ]
    });
  });
});
