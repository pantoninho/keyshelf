import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { CLI, TSX } from "./helpers/cli.js";
import { setupAgeFixtureDir, writeEnvKeyshelf, writeKeyshelfConfig } from "./helpers/fixture.js";
import { setupClipboardStub, type ClipboardStub } from "./helpers/clipboard-stub.js";

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

function runCp(root: string, env: NodeJS.ProcessEnv, args: string[]) {
  return spawnSync(TSX, [CLI, "cp", ...args], { cwd: root, env, encoding: "utf-8" });
}

const supported = process.platform === "darwin" || process.platform === "linux";

describe.skipIf(!supported)("keyshelf cp", () => {
  let root: string;
  let clip: ClipboardStub;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "keyshelf-cp-"));
    await writeFixture(root);
    clip = await setupClipboardStub(root);
  });

  it("copies a resolved secret value to the clipboard", async () => {
    execFileSync(TSX, [CLI, "set", "--env", "dev", "--value", "stored-pw", "db/password"], {
      cwd: root,
      env: clip.env,
      encoding: "utf-8"
    });

    const r = runCp(root, clip.env, ["--env", "dev", "--clear", "0", "db/password"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(await clip.read()).toBe("stored-pw");
  });

  it("copies a resolved config value", async () => {
    const r = runCp(root, clip.env, ["--clear", "0", "db/host"]);
    expect(r.status).toBe(0);
    expect(await clip.read()).toBe("localhost");
  });

  it("emits confirmation to stderr by default and never the value", async () => {
    const r = runCp(root, clip.env, ["--clear", "0", "db/host"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain('copied "db/host"');
    expect(r.stderr).not.toContain("localhost");
  });

  it("--quiet suppresses confirmation", () => {
    const r = runCp(root, clip.env, ["--clear", "0", "--quiet", "db/host"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
  });

  it("rejects unknown key", () => {
    const r = runCp(root, clip.env, ["--clear", "0", "does/not/exist"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('"does/not/exist" is not defined');
  });

  it("rejects negative --clear values", () => {
    const r = runCp(root, clip.env, ["--clear", "-1", "db/host"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("--clear must be a non-negative");
  });
});
