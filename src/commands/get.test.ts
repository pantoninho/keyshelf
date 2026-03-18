import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCli } from "@/commands/test-helpers";

let tempDir: string;
let cli: ReturnType<typeof createCli>;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "keyshelf-get-test-"));
  cli = createCli(tempDir);
  cli(["init", "test-app"]);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("keyshelf get", () => {
  it("retrieves a plaintext value", () => {
    cli(["set", "api/key", "my-secret-123"]);
    const output = cli(["get", "api/key"]);
    expect(output).toBe("my-secret-123");
  });

  it("decrypts an age-encrypted value", () => {
    cli(["set", "--provider", "age", "api/key"], { input: "encrypted-secret" });
    const output = cli(["get", "api/key"]);
    expect(output).toBe("encrypted-secret");
  });

  it("falls back to default when env-specific value is missing", () => {
    cli(["set", "api/key", "default-secret"]);
    const output = cli(["get", "api/key", "--env", "staging"]);
    expect(output).toBe("default-secret");
  });

  it("returns env-specific value over default", () => {
    cli(["set", "api/key", "default-secret"]);
    cli(["set", "api/key", "staging-secret", "--env", "staging"]);
    const output = cli(["get", "api/key", "--env", "staging"]);
    expect(output).toBe("staging-secret");
  });

  it("throws for a missing key", () => {
    expect(() => cli(["get", "nonexistent/key"])).toThrow();
  });

  it("throws when key exists but has no value for requested env and no default", () => {
    cli(["set", "api/key", "staging-only", "--env", "staging"]);
    expect(() => cli(["get", "api/key", "--env", "prod"])).toThrow();
  });

  it("errors when no keyshelf.yaml exists", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "keyshelf-get-noinit-"));
    const emptyCli = createCli(emptyDir);
    try {
      expect(() => emptyCli(["get", "api/key"])).toThrow();
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});
