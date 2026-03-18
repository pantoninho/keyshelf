import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCli } from "@/commands/test-helpers";

let tempDir: string;
let cli: ReturnType<typeof createCli>;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "keyshelf-run-test-"));
  cli = createCli(tempDir);
  cli(["init", "test-app"]);
  cli(["set", "api/key", "secret-123"]);
  cli(["set", "database/url", "postgres://localhost/db"]);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("keyshelf run", () => {
  it("injects resolved env vars into the subprocess", () => {
    const output = cli(["run", "--env", "default", "--", "env"]);
    expect(output).toContain("API_KEY=secret-123");
    expect(output).toContain("DATABASE_URL=postgres://localhost/db");
  });

  it("preserves existing env vars alongside injected ones", () => {
    const output = cli(["run", "--env", "default", "--", "env"]);
    // PATH should still be present from the parent process
    expect(output).toContain("PATH=");
  });

  it("throws when no -- separator is provided", () => {
    expect(() => cli(["run", "--env", "default"])).toThrow();
  });

  it("propagates non-zero exit codes from the subprocess", () => {
    let error: NodeJS.ErrnoException | null = null;
    try {
      cli(["run", "--env", "default", "--", "node", "-e", "process.exit(2)"]);
    } catch (err) {
      error = err as NodeJS.ErrnoException;
    }
    expect(error).not.toBeNull();
    expect(error?.status).toBe(2);
  });

  it("errors when the command does not exist", () => {
    expect(() =>
      cli(["run", "--env", "default", "--", "nonexistent-command-xyz"])
    ).toThrow();
  });

  it("decrypts age-encrypted values before injecting", () => {
    cli(["set", "--provider", "age", "encrypted/secret", "decrypted-value"]);
    const output = cli(["run", "--env", "default", "--", "node", "-e", "process.stdout.write(process.env.ENCRYPTED_SECRET ?? '')"]);
    expect(output).toBe("decrypted-value");
  });

  it("injected value overrides an existing env var with the same name", () => {
    // "my/token" maps to MY_TOKEN via keyToEnvVar; seed a collision with the
    // parent process env, then confirm keyshelf's value wins in the subprocess
    process.env.MY_TOKEN = "original-value";
    cli(["set", "my/token", "overridden-value"]);
    const output = cli(["run", "--env", "default", "--", "node", "-e", "process.stdout.write(process.env.MY_TOKEN ?? '')"]);
    delete process.env.MY_TOKEN;
    expect(output).toBe("overridden-value");
  });
});
