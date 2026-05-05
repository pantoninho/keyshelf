import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { CLI, TSX } from "./helpers/cli.js";
import { setupAgeFixtureDir, writeKeyshelfConfig } from "./helpers/fixture.js";
import { AgeProvider } from "../../src/providers/age.js";

interface CliResult {
  stdout: string;
  stderr: string;
  status: number;
}

function runUp(cwd: string, args: string[] = [], stdin = ""): CliResult {
  try {
    const stdout = execFileSync(TSX, [CLI, "up", ...args], {
      cwd,
      encoding: "utf-8",
      input: stdin,
      stdio: ["pipe", "pipe", "pipe"]
    });
    return { stdout, stderr: "", status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", status: e.status ?? -1 };
  }
}

describe("keyshelf up --plan", () => {
  let root: string;
  let identityFile: string;
  let secretsDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "keyshelf-up-"));
    ({ identityFile, secretsDir } = await setupAgeFixtureDir(root));
  });

  it("reports an in-sync state when storage matches the config (exit 0)", async () => {
    await writeKeyshelfConfig(root, [
      `name: "demo",`,
      `envs: ["dev"],`,
      `keys: {`,
      `  token: secret({ value: age({ identityFile: ${JSON.stringify(identityFile)}, secretsDir: ${JSON.stringify(secretsDir)} }) }),`,
      `},`
    ]);
    const provider = new AgeProvider();
    await provider.set(
      { keyPath: "token", envName: undefined, rootDir: root, config: { identityFile, secretsDir } },
      "secret-value"
    );

    const result = runUp(root, ["--plan"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No changes. Storage is in sync with the config.");
  });

  it("plans a Create when storage is missing for a desired key (exit 2)", async () => {
    await writeKeyshelfConfig(root, [
      `name: "demo",`,
      `envs: ["dev"],`,
      `keys: {`,
      `  token: secret({ value: age({ identityFile: ${JSON.stringify(identityFile)}, secretsDir: ${JSON.stringify(secretsDir)} }) }),`,
      `},`
    ]);

    const result = runUp(root, ["--plan"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("+ token");
    expect(result.stdout).toContain("provider: age");
    expect(result.stdout).toContain("1 to create");
  });

  it("plans a Delete for orphan storage entries (exit 2)", async () => {
    await writeKeyshelfConfig(root, [
      `name: "demo",`,
      `envs: ["dev"],`,
      `keys: {`,
      `  token: secret({ value: age({ identityFile: ${JSON.stringify(identityFile)}, secretsDir: ${JSON.stringify(secretsDir)} }) }),`,
      `},`
    ]);
    const provider = new AgeProvider();
    await provider.set(
      { keyPath: "token", envName: undefined, rootDir: root, config: { identityFile, secretsDir } },
      "current"
    );
    await provider.set(
      {
        keyPath: "legacy",
        envName: undefined,
        rootDir: root,
        config: { identityFile, secretsDir }
      },
      "old"
    );

    const result = runUp(root, ["--plan"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("- legacy");
    expect(result.stdout).toContain("1 to delete");
    expect(result.stdout).toContain("1 unchanged");
  });

  it("infers a Rename via movedFrom and renders it as a single action", async () => {
    await writeKeyshelfConfig(root, [
      `name: "demo",`,
      `envs: ["dev"],`,
      `keys: {`,
      `  databases: {`,
      `    auth: {`,
      `      dbPassword: secret({`,
      `        value: age({ identityFile: ${JSON.stringify(identityFile)}, secretsDir: ${JSON.stringify(secretsDir)} }),`,
      `        movedFrom: "supabase/db-password",`,
      `      }),`,
      `    },`,
      `  },`,
      `},`
    ]);

    const provider = new AgeProvider();
    await provider.set(
      {
        keyPath: "supabase/db-password",
        envName: undefined,
        rootDir: root,
        config: { identityFile, secretsDir }
      },
      "the-password"
    );

    const result = runUp(root, ["--plan"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain(
      "~ databases/auth/dbPassword   (renamed from supabase/db-password)"
    );
    expect(result.stdout).toContain("1 to rename");
  });

  it("renders ambiguity with a movedFrom snippet for each candidate", async () => {
    // Two orphans + one new key with the same shape (envless, age, same params)
    // produce an Ambiguous action when no movedFrom is supplied.
    await writeKeyshelfConfig(root, [
      `name: "demo",`,
      `envs: ["dev"],`,
      `keys: {`,
      `  newKey: secret({ value: age({ identityFile: ${JSON.stringify(identityFile)}, secretsDir: ${JSON.stringify(secretsDir)} }) }),`,
      `},`
    ]);
    const provider = new AgeProvider();
    await provider.set(
      { keyPath: "oldA", envName: undefined, rootDir: root, config: { identityFile, secretsDir } },
      "a"
    );
    await provider.set(
      { keyPath: "oldB", envName: undefined, rootDir: root, config: { identityFile, secretsDir } },
      "b"
    );

    const result = runUp(root, ["--plan"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("? newKey   (ambiguous rename)");
    expect(result.stdout).toContain('secret({ movedFrom: "oldA", ... })');
    expect(result.stdout).toContain('secret({ movedFrom: "oldB", ... })');
    expect(result.stdout).toContain("1 ambiguous");
  });

  it("exits 1 when no keyshelf config is found", () => {
    const result = runUp(root, ["--plan"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("error:");
  });
});

describe("keyshelf up --yes (apply)", () => {
  let root: string;
  let identityFile: string;
  let secretsDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "keyshelf-up-apply-"));
    ({ identityFile, secretsDir } = await setupAgeFixtureDir(root));
  });

  it("applies a Rename: bytes move from old keyPath to new keyPath, source removed", async () => {
    await writeKeyshelfConfig(root, [
      `name: "demo",`,
      `envs: ["dev"],`,
      `keys: {`,
      `  databases: {`,
      `    auth: {`,
      `      dbPassword: secret({`,
      `        value: age({ identityFile: ${JSON.stringify(identityFile)}, secretsDir: ${JSON.stringify(secretsDir)} }),`,
      `        movedFrom: "supabase/db-password",`,
      `      }),`,
      `    },`,
      `  },`,
      `},`
    ]);

    const provider = new AgeProvider();
    await provider.set(
      {
        keyPath: "supabase/db-password",
        envName: undefined,
        rootDir: root,
        config: { identityFile, secretsDir }
      },
      "the-password"
    );

    const result = runUp(root, ["--yes"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 to rename");
    expect(result.stdout).toContain("Applied: 1 rename");

    // Source removed, destination present with the same value.
    const newCtx = {
      keyPath: "databases/auth/dbPassword",
      envName: undefined,
      rootDir: root,
      config: { identityFile, secretsDir }
    };
    const oldCtx = { ...newCtx, keyPath: "supabase/db-password" };
    expect(await provider.validate(newCtx)).toBe(true);
    expect(await provider.validate(oldCtx)).toBe(false);
    expect(await provider.resolve(newCtx)).toBe("the-password");
  });

  it("applies a Delete: orphan storage is removed", async () => {
    await writeKeyshelfConfig(root, [
      `name: "demo",`,
      `envs: ["dev"],`,
      `keys: {`,
      `  token: secret({ value: age({ identityFile: ${JSON.stringify(identityFile)}, secretsDir: ${JSON.stringify(secretsDir)} }) }),`,
      `},`
    ]);
    const provider = new AgeProvider();
    await provider.set(
      { keyPath: "token", envName: undefined, rootDir: root, config: { identityFile, secretsDir } },
      "current"
    );
    await provider.set(
      {
        keyPath: "legacy",
        envName: undefined,
        rootDir: root,
        config: { identityFile, secretsDir }
      },
      "old"
    );

    const result = runUp(root, ["--yes"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Applied: 1 delete");

    expect(
      await provider.validate({
        keyPath: "legacy",
        envName: undefined,
        rootDir: root,
        config: { identityFile, secretsDir }
      })
    ).toBe(false);
    expect(
      await provider.validate({
        keyPath: "token",
        envName: undefined,
        rootDir: root,
        config: { identityFile, secretsDir }
      })
    ).toBe(true);
  });

  it("is idempotent: running --yes twice leaves the second invocation as a no-op", async () => {
    await writeKeyshelfConfig(root, [
      `name: "demo",`,
      `envs: ["dev"],`,
      `keys: {`,
      `  token: secret({ value: age({ identityFile: ${JSON.stringify(identityFile)}, secretsDir: ${JSON.stringify(secretsDir)} }) }),`,
      `},`
    ]);
    const provider = new AgeProvider();
    await provider.set(
      { keyPath: "token", envName: undefined, rootDir: root, config: { identityFile, secretsDir } },
      "v"
    );
    await provider.set(
      { keyPath: "stale", envName: undefined, rootDir: root, config: { identityFile, secretsDir } },
      "old"
    );

    const first = runUp(root, ["--yes"]);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("Applied: 1 delete");

    const second = runUp(root, ["--yes"]);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("No changes. Storage is in sync with the config.");
  });

  it("refuses to apply when the plan contains Ambiguous actions (exit 1)", async () => {
    await writeKeyshelfConfig(root, [
      `name: "demo",`,
      `envs: ["dev"],`,
      `keys: {`,
      `  newKey: secret({ value: age({ identityFile: ${JSON.stringify(identityFile)}, secretsDir: ${JSON.stringify(secretsDir)} }) }),`,
      `},`
    ]);
    const provider = new AgeProvider();
    await provider.set(
      { keyPath: "oldA", envName: undefined, rootDir: root, config: { identityFile, secretsDir } },
      "a"
    );
    await provider.set(
      { keyPath: "oldB", envName: undefined, rootDir: root, config: { identityFile, secretsDir } },
      "b"
    );

    const result = runUp(root, ["--yes"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ambiguous");
    // Storage left untouched.
    const ctxFor = (keyPath: string) => ({
      keyPath,
      envName: undefined,
      rootDir: root,
      config: { identityFile, secretsDir }
    });
    expect(await provider.validate(ctxFor("oldA"))).toBe(true);
    expect(await provider.validate(ctxFor("oldB"))).toBe(true);
  });

  it("interactive default: 'n' on the prompt cancels without mutating storage (exit 0)", async () => {
    await writeKeyshelfConfig(root, [
      `name: "demo",`,
      `envs: ["dev"],`,
      `keys: {`,
      `  token: secret({ value: age({ identityFile: ${JSON.stringify(identityFile)}, secretsDir: ${JSON.stringify(secretsDir)} }) }),`,
      `},`
    ]);
    const provider = new AgeProvider();
    // token in storage matches the desired key — `stale` is therefore a
    // pure orphan, not a rename candidate.
    await provider.set(
      { keyPath: "token", envName: undefined, rootDir: root, config: { identityFile, secretsDir } },
      "current"
    );
    await provider.set(
      { keyPath: "stale", envName: undefined, rootDir: root, config: { identityFile, secretsDir } },
      "old"
    );

    const result = runUp(root, [], "n\n");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Apply cancelled.");
    // Stale remains.
    expect(
      await provider.validate({
        keyPath: "stale",
        envName: undefined,
        rootDir: root,
        config: { identityFile, secretsDir }
      })
    ).toBe(true);
  });

  it("interactive default: 'y' on the prompt applies the plan", async () => {
    await writeKeyshelfConfig(root, [
      `name: "demo",`,
      `envs: ["dev"],`,
      `keys: {`,
      `  token: secret({ value: age({ identityFile: ${JSON.stringify(identityFile)}, secretsDir: ${JSON.stringify(secretsDir)} }) }),`,
      `},`
    ]);
    const provider = new AgeProvider();
    await provider.set(
      { keyPath: "token", envName: undefined, rootDir: root, config: { identityFile, secretsDir } },
      "current"
    );
    await provider.set(
      { keyPath: "stale", envName: undefined, rootDir: root, config: { identityFile, secretsDir } },
      "old"
    );

    const result = runUp(root, [], "y\n");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Applied: 1 delete");
    expect(
      await provider.validate({
        keyPath: "stale",
        envName: undefined,
        rootDir: root,
        config: { identityFile, secretsDir }
      })
    ).toBe(false);
  });
});
