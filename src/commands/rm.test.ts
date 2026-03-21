import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCli } from "@/commands/test-helpers";

let tempDir: string;
let cli: ReturnType<typeof createCli>;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "keyshelf-rm-test-"));
  cli = createCli(tempDir);
  cli(["init", "test-app"]);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("keyshelf rm (plaintext)", () => {
  it("removes a value for the default env", async () => {
    cli(["set", "database/url", "postgres://localhost/db"]);
    cli(["rm", "database/url", "--yes"]);

    const yaml = await readFile(join(tempDir, "keyshelf.yaml"), "utf-8");
    expect(yaml).not.toContain("database/url");
  });

  it("removes a value for a specific env while leaving others intact", async () => {
    cli(["set", "api/key", "default-value"]);
    cli(["set", "api/key", "staging-value", "--env", "staging"]);
    cli(["rm", "api/key", "--env", "staging", "--yes"]);

    const yaml = await readFile(join(tempDir, "keyshelf.yaml"), "utf-8");
    expect(yaml).toContain("api/key");
    expect(yaml).not.toContain("staging-value");
    expect(yaml).toContain("default-value");
  });

  it("removes the entire key entry when the last env value is deleted", async () => {
    cli(["set", "api/key", "only-value"]);
    cli(["rm", "api/key", "--yes"]);

    const yaml = await readFile(join(tempDir, "keyshelf.yaml"), "utf-8");
    expect(yaml).not.toContain("api/key");
  });
});

describe("keyshelf rm (error cases)", () => {
  it("errors when key doesn't exist", () => {
    expect(() => cli(["rm", "nonexistent/key", "--yes"])).toThrow();
  });

  it("errors when env doesn't exist on key", () => {
    cli(["set", "api/key", "some-value"]);
    expect(() => cli(["rm", "api/key", "--env", "nonexistent", "--yes"])).toThrow();
  });

  it("errors when no keyshelf.yaml exists", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "keyshelf-rm-noinit-"));
    const emptyCli = createCli(emptyDir);
    try {
      expect(() => emptyCli(["rm", "api/key", "--yes"])).toThrow();
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});

describe("keyshelf rm (round-trip)", () => {
  it("set then rm then get should error with not found", () => {
    cli(["set", "database/url", "postgres://localhost/db"]);
    cli(["rm", "database/url", "--yes"]);
    expect(() => cli(["get", "database/url"])).toThrow();
  });
});
