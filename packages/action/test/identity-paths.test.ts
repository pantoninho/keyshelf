import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { join, isAbsolute } from "node:path";
import {
  ageIdentityFile,
  collectAgeIdentityFiles,
  ensureTrailingNewline,
  resolveIdentityPath
} from "../scripts/identity-paths.mjs";

describe("ageIdentityFile", () => {
  it("returns the identityFile when binding is an age provider with a string path", () => {
    expect(
      ageIdentityFile({ __kind: "provider:age", options: { identityFile: "./key.txt" } })
    ).toBe("./key.txt");
  });

  it("returns undefined for non-age providers", () => {
    expect(
      ageIdentityFile({ __kind: "provider:gcp", options: { identityFile: "./key.txt" } })
    ).toBeUndefined();
  });

  it("returns undefined for null/undefined/non-object bindings", () => {
    expect(ageIdentityFile(null)).toBeUndefined();
    expect(ageIdentityFile(undefined)).toBeUndefined();
    expect(ageIdentityFile("string")).toBeUndefined();
    expect(ageIdentityFile(42)).toBeUndefined();
  });

  it("returns undefined when identityFile is missing or empty", () => {
    expect(ageIdentityFile({ __kind: "provider:age", options: {} })).toBeUndefined();
    expect(
      ageIdentityFile({ __kind: "provider:age", options: { identityFile: "" } })
    ).toBeUndefined();
    expect(
      ageIdentityFile({ __kind: "provider:age", options: { identityFile: 123 } })
    ).toBeUndefined();
    expect(ageIdentityFile({ __kind: "provider:age" })).toBeUndefined();
  });
});

describe("collectAgeIdentityFiles", () => {
  it("returns empty array when there are no secret records", () => {
    const config = {
      keys: [{ kind: "config", path: "db/host" }]
    };
    expect(collectAgeIdentityFiles(config)).toEqual([]);
  });

  it("collects identityFile from a record's `value` binding", () => {
    const config = {
      keys: [
        {
          kind: "secret",
          path: "db/password",
          value: { __kind: "provider:age", options: { identityFile: "./a.txt" } }
        }
      ]
    };
    expect(collectAgeIdentityFiles(config)).toEqual(["./a.txt"]);
  });

  it("collects identityFile from per-env `values` bindings", () => {
    const config = {
      keys: [
        {
          kind: "secret",
          path: "db/password",
          values: {
            dev: { __kind: "provider:age", options: { identityFile: "./dev.txt" } },
            prod: { __kind: "provider:age", options: { identityFile: "./prod.txt" } }
          }
        }
      ]
    };
    expect(collectAgeIdentityFiles(config).sort()).toEqual(["./dev.txt", "./prod.txt"]);
  });

  it("deduplicates repeated paths across records and envs", () => {
    const same = { __kind: "provider:age", options: { identityFile: "./shared.txt" } };
    const config = {
      keys: [
        { kind: "secret", path: "a", value: same },
        { kind: "secret", path: "b", value: same, values: { dev: same } }
      ]
    };
    expect(collectAgeIdentityFiles(config)).toEqual(["./shared.txt"]);
  });

  it("ignores non-age provider bindings and config keys", () => {
    const config = {
      keys: [
        { kind: "config", path: "db/host", value: "localhost" },
        {
          kind: "secret",
          path: "db/password",
          value: { __kind: "provider:gcp", options: { project: "p" } }
        }
      ]
    };
    expect(collectAgeIdentityFiles(config)).toEqual([]);
  });
});

describe("resolveIdentityPath", () => {
  it("expands ~ to the home directory", () => {
    expect(resolveIdentityPath("~/key.txt", "/repo")).toBe(join(homedir(), "key.txt"));
    expect(resolveIdentityPath("~", "/repo")).toBe(homedir());
  });

  it("returns absolute paths unchanged", () => {
    const abs = isAbsolute("/etc/key") ? "/etc/key" : "C:/etc/key";
    expect(resolveIdentityPath(abs, "/repo")).toBe(abs);
  });

  it("resolves relative paths against rootDir", () => {
    expect(resolveIdentityPath("./key.txt", "/repo")).toBe(join("/repo", "key.txt"));
    expect(resolveIdentityPath("keys/age.txt", "/repo")).toBe(join("/repo", "keys", "age.txt"));
  });
});

describe("ensureTrailingNewline", () => {
  it("appends a newline when missing", () => {
    expect(ensureTrailingNewline("abc")).toBe("abc\n");
  });

  it("leaves content with trailing newline alone", () => {
    expect(ensureTrailingNewline("abc\n")).toBe("abc\n");
  });
});
