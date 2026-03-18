import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCli } from "@/commands/test-helpers";

let tempDir: string;
let cli: ReturnType<typeof createCli>;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "keyshelf-set-test-"));
  cli = createCli(tempDir);
  cli(["init", "test-app"]);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("keyshelf set (plaintext)", () => {
  it("stores a positional value as plaintext when no --provider is given", async () => {
    cli(["set", "database/url", "postgres://localhost/db"]);

    const yaml = await readFile(join(tempDir, "keyshelf.yaml"), "utf-8");
    expect(yaml).toContain("database/url");
    expect(yaml).not.toContain("!age");
    expect(yaml).not.toContain("-----BEGIN AGE ENCRYPTED FILE-----");
  });

  it("reads value from piped stdin when value arg is omitted", async () => {
    cli(["set", "api/key"], { input: "piped-secret" });

    const yaml = await readFile(join(tempDir, "keyshelf.yaml"), "utf-8");
    expect(yaml).not.toContain("!age");

    const output = cli(["get", "api/key"]);
    expect(output).toBe("piped-secret");
  });

  it("plaintext set + get round-trip returns the original value", () => {
    cli(["set", "database/url", "postgres://localhost/db"]);
    const output = cli(["get", "database/url"]);
    expect(output).toBe("postgres://localhost/db");
  });

  it("stores a positional value under the specified --env", async () => {
    cli(["set", "api/key", "staging-positional", "--env", "staging"]);

    const yaml = await readFile(join(tempDir, "keyshelf.yaml"), "utf-8");
    expect(yaml).toContain("staging:");
    expect(yaml).toContain("staging-positional");
  });

  it("round-trips a positional value with --env through get", () => {
    cli(["set", "api/key", "staging-positional", "--env", "staging"]);
    const output = cli(["get", "api/key", "--env", "staging"]);
    expect(output).toBe("staging-positional");
  });

  it("overwrites an encrypted value with a plaintext one", async () => {
    cli(["set", "--provider", "age", "api/key"], { input: "encrypted-secret" });
    let yaml = await readFile(join(tempDir, "keyshelf.yaml"), "utf-8");
    expect(yaml).toContain("!age");

    cli(["set", "api/key", "plaintext-replacement"]);

    yaml = await readFile(join(tempDir, "keyshelf.yaml"), "utf-8");
    expect(yaml).not.toContain("!age");
    expect(yaml).not.toContain("-----BEGIN AGE ENCRYPTED FILE-----");

    const output = cli(["get", "api/key"]);
    expect(output).toBe("plaintext-replacement");
  });
});

describe("keyshelf set --provider age (encrypted)", () => {
  it("stores a positional value encrypted when --provider age is given", async () => {
    cli(["set", "--provider", "age", "api/key", "secret"]);

    const yaml = await readFile(join(tempDir, "keyshelf.yaml"), "utf-8");
    expect(yaml).toContain("api/key");
    expect(yaml).toContain("!age");
    expect(yaml).toContain("-----BEGIN AGE ENCRYPTED FILE-----");
  });

  it("stores a piped value encrypted when --provider age is given", async () => {
    cli(["set", "--provider", "age", "api/key"], { input: "secret" });

    const yaml = await readFile(join(tempDir, "keyshelf.yaml"), "utf-8");
    expect(yaml).toContain("api/key");
    expect(yaml).toContain("!age");
    expect(yaml).toContain("-----BEGIN AGE ENCRYPTED FILE-----");
  });

  it("encrypted set + get round-trip returns the original value", () => {
    cli(["set", "--provider", "age", "api/key", "secret"]);
    const output = cli(["get", "api/key"]);
    expect(output).toBe("secret");
  });

  it("stores an encrypted value under the specified --env", async () => {
    cli(["set", "--provider", "age", "api/key", "secret", "--env", "staging"]);

    const yaml = await readFile(join(tempDir, "keyshelf.yaml"), "utf-8");
    expect(yaml).toContain("staging:");
    expect(yaml).toContain("!age");
  });
});

describe("keyshelf set (multiple keys)", () => {
  it("can set multiple keys", async () => {
    cli(["set", "api/key", "secret-1"]);
    cli(["set", "database/url", "secret-2"]);

    const yaml = await readFile(join(tempDir, "keyshelf.yaml"), "utf-8");
    expect(yaml).toContain("api/key");
    expect(yaml).toContain("database/url");
  });
});

describe("keyshelf set (error cases)", () => {
  it("errors when an unknown provider is specified", () => {
    expect(() => cli(["set", "--provider", "unknown", "api/key", "value"])).toThrow();
  });

  it("errors when no keyshelf.yaml exists", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "keyshelf-set-noinit-"));
    const emptyCli = createCli(emptyDir);
    try {
      expect(() => emptyCli(["set", "api/key", "value"])).toThrow();
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});
