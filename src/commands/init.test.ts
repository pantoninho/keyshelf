import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCli } from "@/commands/test-helpers";

let tempDir: string;
let cli: ReturnType<typeof createCli>;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "keyshelf-init-test-"));
  cli = createCli(tempDir);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("keyshelf init", () => {
  it("creates keyshelf.yaml with correct structure and generates a keypair", async () => {
    const output = cli(["init", "my-app"]);

    expect(output).toContain("Initialized project 'my-app'");
    expect(output).toContain("Public key:");
    expect(output).toContain("Private key:");

    const yaml = await readFile(join(tempDir, "keyshelf.yaml"), "utf-8");
    expect(yaml).toContain("project: my-app");
    expect(yaml).toContain("publicKey: age1");
    expect(yaml).toContain("keys:");

    // private key file exists with correct permissions
    const keyPath = join(tempDir, ".config", "keyshelf", "my-app", "key");
    const keyContent = await readFile(keyPath, "utf-8");
    expect(keyContent).toMatch(/^AGE-SECRET-KEY-/);

    const info = await stat(keyPath);
    expect(info.mode & 0o777).toBe(0o600);
  });

  it("refuses to init if keyshelf.yaml already exists", async () => {
    cli(["init", "my-app"]);

    expect(() => cli(["init", "my-app"])).toThrow();
  });
});
