import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { join, isAbsolute } from "node:path";
import {
  identityFile,
  collectIdentityFiles,
  ensureTrailingNewline,
  resolveIdentityPath
} from "../scripts/identity-paths.mjs";

describe("identityFile", () => {
  it("returns the identityFile when binding is an age provider with a string path", () => {
    expect(identityFile({ __kind: "provider:age", options: { identityFile: "./key.txt" } })).toBe(
      "./key.txt"
    );
  });

  it("returns the identityFile when binding is a sops provider with a string path", () => {
    expect(identityFile({ __kind: "provider:sops", options: { identityFile: "./key.txt" } })).toBe(
      "./key.txt"
    );
  });

  it("returns undefined for providers that don't consume an identity file", () => {
    expect(
      identityFile({ __kind: "provider:gcp", options: { identityFile: "./key.txt" } })
    ).toBeUndefined();
  });

  it("returns undefined for null/undefined/non-object bindings", () => {
    expect(identityFile(null)).toBeUndefined();
    expect(identityFile(undefined)).toBeUndefined();
    expect(identityFile("string")).toBeUndefined();
    expect(identityFile(42)).toBeUndefined();
  });

  it("returns undefined when identityFile is missing or empty", () => {
    expect(identityFile({ __kind: "provider:age", options: {} })).toBeUndefined();
    expect(identityFile({ __kind: "provider:age", options: { identityFile: "" } })).toBeUndefined();
    expect(
      identityFile({ __kind: "provider:age", options: { identityFile: 123 } })
    ).toBeUndefined();
    expect(identityFile({ __kind: "provider:age" })).toBeUndefined();
    expect(identityFile({ __kind: "provider:sops", options: {} })).toBeUndefined();
  });
});

describe("collectIdentityFiles", () => {
  it("returns empty array when there are no secret records", () => {
    const config = {
      keys: [{ kind: "config", path: "db/host" }]
    };
    expect(collectIdentityFiles(config)).toEqual([]);
  });

  it("collects identityFile from a record's `value` binding (age)", () => {
    const config = {
      keys: [
        {
          kind: "secret",
          path: "db/password",
          value: { __kind: "provider:age", options: { identityFile: "./a.txt" } }
        }
      ]
    };
    expect(collectIdentityFiles(config)).toEqual(["./a.txt"]);
  });

  it("collects identityFile from a record's `value` binding (sops)", () => {
    const config = {
      keys: [
        {
          kind: "secret",
          path: "db/password",
          value: {
            __kind: "provider:sops",
            options: { identityFile: "./s.txt", secretsFile: "./s.json" }
          }
        }
      ]
    };
    expect(collectIdentityFiles(config)).toEqual(["./s.txt"]);
  });

  it("collects identityFile from per-env `values` bindings across age and sops", () => {
    const config = {
      keys: [
        {
          kind: "secret",
          path: "db/password",
          values: {
            dev: { __kind: "provider:age", options: { identityFile: "./dev.txt" } },
            prod: {
              __kind: "provider:sops",
              options: { identityFile: "./prod.txt", secretsFile: "./prod.json" }
            }
          }
        }
      ]
    };
    expect(collectIdentityFiles(config).sort()).toEqual(["./dev.txt", "./prod.txt"]);
  });

  it("deduplicates repeated paths across records, envs, and provider kinds", () => {
    const age = { __kind: "provider:age", options: { identityFile: "./shared.txt" } };
    const sops = {
      __kind: "provider:sops",
      options: { identityFile: "./shared.txt", secretsFile: "./s.json" }
    };
    const config = {
      keys: [
        { kind: "secret", path: "a", value: age },
        { kind: "secret", path: "b", value: sops, values: { dev: age } }
      ]
    };
    expect(collectIdentityFiles(config)).toEqual(["./shared.txt"]);
  });

  it("ignores provider bindings that don't consume an identity file", () => {
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
    expect(collectIdentityFiles(config)).toEqual([]);
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
