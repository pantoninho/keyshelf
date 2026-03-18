import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCli } from "@/commands/test-helpers";
import { rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";

let tempDir: string;
let cli: ReturnType<typeof createCli>;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "keyshelf-export-test-"));
  cli = createCli(tempDir);
  cli(["init", "test-app"]);
  cli(["set", "api/key", "secret-123"]);
  cli(["set", "database/url", "postgres://localhost/db"]);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("keyshelf export", () => {
  it("exports in dotenv format by default", () => {
    const output = cli(["export", "--env", "default"]);
    expect(output).toContain('API_KEY="secret-123"');
    expect(output).toContain('DATABASE_URL="postgres://localhost/db"');
  });

  it("exports in json format", () => {
    const output = cli(["export", "--env", "default", "--format", "json"]);
    const parsed = JSON.parse(output);
    expect(parsed.API_KEY).toBe("secret-123");
    expect(parsed.DATABASE_URL).toBe("postgres://localhost/db");
  });

  it("throws for an unknown format", () => {
    expect(() => cli(["export", "--env", "default", "--format", "xml"])).toThrow();
  });

  it("exports value containing double quotes in dotenv format without escaping", () => {
    cli(["set", "greeting", 'say "hello"']);
    const output = cli(["export", "--env", "default"]);
    expect(output).toContain('GREETING="say "hello""');
  });

  it("exports multiline value in dotenv format with literal newlines inside the quotes", () => {
    cli(["set", "cert"], { input: "line1\nline2\nline3" });
    const output = cli(["export", "--env", "default"]);
    expect(output).toContain('CERT="line1\nline2\nline3"');
  });

  it("decrypts age-encrypted values before exporting", () => {
    cli(["set", "--provider", "age", "encrypted/secret", "decrypted-value"]);
    const output = cli(["export", "--env", "default"]);
    expect(output).toContain('ENCRYPTED_SECRET="decrypted-value"');
  });

  it("falls back to default values when env-specific override is missing", () => {
    cli(["set", "api/key", "staging-key", "--env", "staging"]);

    const output = cli(["export", "--env", "staging"]);
    expect(output).toContain('API_KEY="staging-key"');
    expect(output).toContain('DATABASE_URL="postgres://localhost/db"');
  });

  it("produces empty output when the schema has no keys", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "keyshelf-export-empty-"));
    try {
      const emptyCli = createCli(emptyDir);
      emptyCli(["init", "empty-app"]);
      const output = emptyCli(["export", "--env", "default"]);
      expect(output).toBe("");
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
