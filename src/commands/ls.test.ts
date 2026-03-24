import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCli } from "@/commands/test-helpers";

let tempDir: string;
let cli: ReturnType<typeof createCli>;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "keyshelf-ls-test-"));
  cli = createCli(tempDir);
  cli(["init", "test-app"]);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("keyshelf ls", () => {
  it("shows nothing when there are no keys", () => {
    const output = cli(["ls"]);
    expect(output.trim()).toBe("No keys found.");
  });

  it("lists a single plain key", () => {
    cli(["set", "database/url", "postgres://localhost/db"]);
    const output = cli(["ls"]);
    expect(output).toContain("database/url");
    expect(output).toContain("default (plain)");
  });

  it("lists an age-encrypted key", () => {
    cli(["set", "--provider", "age", "api/key"], { input: "secret" });
    const output = cli(["ls"]);
    expect(output).toContain("api/key");
    expect(output).toContain("default (!age)");
  });

  it("lists multiple keys with multiple environments", () => {
    cli(["set", "database/url", "localhost"]);
    cli(["set", "database/url", "staging-db", "--env", "staging"]);
    cli(["set", "--provider", "age", "api/key"], { input: "secret" });

    const output = cli(["ls"]);
    expect(output).toContain("database/url");
    expect(output).toContain("default (plain)");
    expect(output).toContain("staging (plain)");
    expect(output).toContain("api/key");
    expect(output).toContain("default (!age)");
  });

  it("shows default environment before others", () => {
    cli(["set", "app/port", "3000", "--env", "staging"]);
    cli(["set", "app/port", "8080"]);

    const output = cli(["ls"]);
    const line = output.split("\n").find((l) => l.includes("app/port"))!;
    const defaultIdx = line.indexOf("default");
    const stagingIdx = line.indexOf("staging");
    expect(defaultIdx).toBeLessThan(stagingIdx);
  });
});
