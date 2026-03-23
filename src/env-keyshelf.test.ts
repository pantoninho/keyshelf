import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseEnvKeyshelf, findEnvKeyshelfPath } from "@/env-keyshelf";

describe("parseEnvKeyshelf", () => {
  it("parses valid key=value lines into a mapping", () => {
    const content = "DB_PASSWORD=database.password\nAPI_KEY=api.key";
    expect(parseEnvKeyshelf(content)).toEqual({
      DB_PASSWORD: "database.password",
      API_KEY: "api.key"
    });
  });

  it("skips blank lines and comments", () => {
    const content = [
      "# this is a comment",
      "",
      "DB_PASSWORD=database.password",
      "  ",
      "  # indented comment",
      "API_KEY=api.key"
    ].join("\n");
    expect(parseEnvKeyshelf(content)).toEqual({
      DB_PASSWORD: "database.password",
      API_KEY: "api.key"
    });
  });

  it("trims whitespace around = sign", () => {
    const content = "  DB_PASSWORD  =  database.password  ";
    expect(parseEnvKeyshelf(content)).toEqual({
      DB_PASSWORD: "database.password"
    });
  });

  it("throws on line with no = sign", () => {
    expect(() => parseEnvKeyshelf("INVALID_LINE")).toThrow(
      "Malformed line 1 in .env.keyshelf: missing '='"
    );
  });

  it("throws on empty env var name", () => {
    expect(() => parseEnvKeyshelf("=database.password")).toThrow(
      "Malformed line 1 in .env.keyshelf: empty env var name"
    );
  });

  it("throws on empty key path", () => {
    expect(() => parseEnvKeyshelf("DB_PASSWORD=")).toThrow(
      "Malformed line 1 in .env.keyshelf: empty key path"
    );
  });

  it("allows duplicate env var names (last wins)", () => {
    const content = "DB_URL=database.url\nDB_URL=database.connection";
    expect(parseEnvKeyshelf(content)).toEqual({
      DB_URL: "database.connection"
    });
  });

  it("allows same key path mapped to multiple env vars", () => {
    const content = "SUPABASE_URL=supabase.url\nEXPO_PUBLIC_SUPABASE_URL=supabase.url";
    expect(parseEnvKeyshelf(content)).toEqual({
      SUPABASE_URL: "supabase.url",
      EXPO_PUBLIC_SUPABASE_URL: "supabase.url"
    });
  });

  it("returns empty record for file with only comments and blanks", () => {
    const content = "# just a comment\n\n  \n";
    expect(parseEnvKeyshelf(content)).toEqual({});
  });
});

describe("findEnvKeyshelfPath", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "keyshelf-envfile-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("finds .env.keyshelf in the given directory", async () => {
    const filePath = join(tempDir, ".env.keyshelf");
    await writeFile(filePath, "DB_URL=database.url");

    expect(findEnvKeyshelfPath(tempDir)).toBe(filePath);
  });

  it("finds .env.keyshelf in an ancestor directory", async () => {
    const filePath = join(tempDir, ".env.keyshelf");
    await writeFile(filePath, "DB_URL=database.url");

    const subDir = join(tempDir, "sub", "deep");
    await mkdir(subDir, { recursive: true });

    expect(findEnvKeyshelfPath(subDir)).toBe(filePath);
  });

  it("returns null when no .env.keyshelf exists", () => {
    expect(findEnvKeyshelfPath(tempDir)).toBeNull();
  });
});
