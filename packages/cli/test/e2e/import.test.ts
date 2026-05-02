import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { writeFileSync as fsWriteFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { generateIdentity } from "../../src/providers/age.js";
import { CLI, TSX } from "./helpers/cli.js";

function writeFileSync(path: string, lines: string[]): void {
  fsWriteFileSync(path, lines.join("\n") + "\n");
}

async function writeFixture(root: string) {
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
      `  envs: ["dev"],`,
      `  keys: {`,
      `    db: {`,
      `      host: config({ default: "localhost" }),`,
      `      password: secret({ value: age({ identityFile: ${JSON.stringify(identityFile)}, secretsDir: ${JSON.stringify(secretsDir)} }) }),`,
      `      apiKey: secret({ value: age({ identityFile: ${JSON.stringify(identityFile)}, secretsDir: ${JSON.stringify(secretsDir)} }) }),`,
      `    },`,
      `  },`,
      `});`,
      ``
    ].join("\n")
  );
  await writeFile(
    join(root, ".env.keyshelf"),
    ["DB_HOST=db/host", "DB_PASSWORD=db/password", "DB_API_KEY=db/apiKey"].join("\n")
  );
}

describe("keyshelf-next import", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "keyshelf-import-"));
    await writeFixture(root);
  });

  it("imports secrets via their bound providers and warns about config keys", () => {
    const envFile = join(root, ".env.values");
    writeFileSync(envFile, ["DB_HOST=imported-host", "DB_PASSWORD=imported-pw", "DB_API_KEY=k1"]);

    const out = execFileSync(TSX, [CLI, "import", "--env", "dev", "--file", envFile], {
      cwd: root,
      encoding: "utf-8",
      stdio: ["inherit", "pipe", "pipe"]
    });

    expect(out).toContain("Imported 2 values");

    const result = execFileSync(
      TSX,
      [
        CLI,
        "run",
        "--env",
        "dev",
        "--",
        "node",
        "-e",
        "console.log(JSON.stringify({h: process.env.DB_HOST, p: process.env.DB_PASSWORD, k: process.env.DB_API_KEY}))"
      ],
      { cwd: root, encoding: "utf-8" }
    );
    // DB_HOST stays at the config default (config keys are not written by import).
    expect(JSON.parse(result.trim())).toEqual({
      h: "localhost",
      p: "imported-pw",
      k: "k1"
    });
  });

  it("skips unmapped env vars", () => {
    const envFile = join(root, ".env.values");
    writeFileSync(envFile, ["UNMAPPED=foo", "DB_PASSWORD=imported-pw"]);

    const out = execFileSync(TSX, [CLI, "import", "--env", "dev", "--file", envFile], {
      cwd: root,
      encoding: "utf-8"
    });
    expect(out).toContain("Imported 1 values, skipped 1");
  });

  it("skips keys outside the --group filter", async () => {
    const groupedRoot = await mkdtemp(join(tmpdir(), "keyshelf-import-group-"));
    const identityFile = join(groupedRoot, "key.txt");
    const secretsDir = join(groupedRoot, ".keyshelf", "secrets");
    await writeFile(identityFile, await generateIdentity());
    await mkdir(secretsDir, { recursive: true });

    await writeFile(
      join(groupedRoot, "keyshelf.config.ts"),
      [
        `import { defineConfig, secret, age } from "keyshelf/config";`,
        ``,
        `export default defineConfig({`,
        `  name: "demo",`,
        `  envs: ["dev"],`,
        `  groups: ["app", "ci"],`,
        `  keys: {`,
        `    db: {`,
        `      password: secret({ group: "app", value: age({ identityFile: ${JSON.stringify(identityFile)}, secretsDir: ${JSON.stringify(secretsDir)} }) }),`,
        `    },`,
        `    github: {`,
        `      token: secret({ group: "ci", value: age({ identityFile: ${JSON.stringify(identityFile)}, secretsDir: ${JSON.stringify(secretsDir)} }) }),`,
        `    },`,
        `  },`,
        `});`,
        ``
      ].join("\n")
    );
    await writeFile(
      join(groupedRoot, ".env.keyshelf"),
      ["DB_PASSWORD=db/password", "GITHUB_TOKEN=github/token"].join("\n")
    );

    const envFile = join(groupedRoot, ".env.values");
    writeFileSync(envFile, ["DB_PASSWORD=imported-pw", "GITHUB_TOKEN=imported-tok"]);

    const result = execFileSync(
      TSX,
      [CLI, "import", "--env", "dev", "--group", "app", "--file", envFile],
      {
        cwd: groupedRoot,
        encoding: "utf-8",
        stdio: ["inherit", "pipe", "pipe"]
      }
    );

    expect(result).toContain("Imported 1 values, skipped 1");
    expect(result).toContain("DB_PASSWORD -> db/password");
    expect(result).not.toContain("GITHUB_TOKEN -> github/token");

    const revealed = execFileSync(
      TSX,
      [
        CLI,
        "ls",
        "--env",
        "dev",
        "--group",
        "app",
        "--reveal",
        "--map",
        ".env.keyshelf",
        "--format",
        "json"
      ],
      { cwd: groupedRoot, encoding: "utf-8", stdio: ["inherit", "pipe", "pipe"] }
    );
    const parsed = JSON.parse(revealed) as {
      vars: { envVar: string; value: string }[];
    };
    const dbVar = parsed.vars.find((v) => v.envVar === "DB_PASSWORD");
    expect(dbVar?.value).toBe("imported-pw");
  });
});
