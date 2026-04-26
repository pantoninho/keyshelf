import { describe, it, expect, vi } from "vitest";
import { describeSource, buildJsonVars } from "../../../src/cli/ls.js";
import type { KeyDefinition } from "../../../src/config/schema.js";
import type { EnvConfig } from "../../../src/config/environment.js";
import type { AppMapping } from "../../../src/config/app-mapping.js";

const configKey = (path: string, defaultValue?: string): KeyDefinition => ({
  path,
  isSecret: false,
  optional: false,
  defaultValue
});

const secretKey = (path: string, optional = false): KeyDefinition => ({
  path,
  isSecret: true,
  optional
});

describe("describeSource", () => {
  it("returns plaintext override value", () => {
    const env: EnvConfig = { overrides: { "db/host": "prod-db" } };
    expect(describeSource(configKey("db/host", "localhost"), env)).toBe("override: prod-db");
  });

  it("returns provider tag for tagged override", () => {
    const env: EnvConfig = {
      overrides: {
        "db/password": { tag: "gcp", config: { name: "db-pass" } }
      }
    };
    expect(describeSource(secretKey("db/password"), env)).toBe("provider: gcp");
  });

  it("returns default provider for secret with no override", () => {
    const env: EnvConfig = {
      defaultProvider: { name: "age", options: {} },
      overrides: {}
    };
    expect(describeSource(secretKey("db/password"), env)).toBe("provider: age");
  });

  it("returns schema default for config with no override", () => {
    const env: EnvConfig = { overrides: {} };
    expect(describeSource(configKey("db/port", "5432"), env)).toBe("default: 5432");
  });

  it("returns (optional, no value) for optional key with no source", () => {
    const env: EnvConfig = { overrides: {} };
    expect(describeSource(secretKey("auth/token", true), env)).toBe("(optional, no value)");
  });

  it("returns (missing) for required key with no source", () => {
    const env: EnvConfig = { overrides: {} };
    expect(describeSource(secretKey("db/password"), env)).toBe("(missing)");
  });

  it("returns (missing) for required config with no default and no override", () => {
    const env: EnvConfig = { overrides: {} };
    expect(describeSource(configKey("db/host"), env)).toBe("(missing)");
  });

  it("plaintext override takes precedence over default provider", () => {
    const env: EnvConfig = {
      defaultProvider: { name: "age", options: {} },
      overrides: { "db/host": "override-value" }
    };
    expect(describeSource(configKey("db/host", "localhost"), env)).toBe("override: override-value");
  });

  it("tagged override takes precedence over default provider", () => {
    const env: EnvConfig = {
      defaultProvider: { name: "age", options: {} },
      overrides: {
        "db/password": { tag: "gcp", config: {} }
      }
    };
    expect(describeSource(secretKey("db/password"), env)).toBe("provider: gcp");
  });
});

describe("buildJsonVars", () => {
  const schema: KeyDefinition[] = [
    configKey("db/host", "localhost"),
    secretKey("db/password"),
    secretKey("auth/token", true)
  ];

  it("emits secret flag from schema for direct mappings", () => {
    const mappings: AppMapping[] = [
      { envVar: "DB_HOST", keyPath: "db/host" },
      { envVar: "DB_PASSWORD", keyPath: "db/password" }
    ];
    const resolved = new Map([
      ["db/host", "prod-db"],
      ["db/password", "s3cret"]
    ]);
    expect(buildJsonVars(mappings, schema, resolved)).toEqual([
      { envVar: "DB_HOST", keyPath: "db/host", value: "prod-db", secret: false },
      { envVar: "DB_PASSWORD", keyPath: "db/password", value: "s3cret", secret: true }
    ]);
  });

  it("omits direct mappings whose keys did not resolve", () => {
    const mappings: AppMapping[] = [
      { envVar: "DB_HOST", keyPath: "db/host" },
      { envVar: "AUTH_TOKEN", keyPath: "auth/token" }
    ];
    const resolved = new Map([["db/host", "prod-db"]]);
    expect(buildJsonVars(mappings, schema, resolved)).toEqual([
      { envVar: "DB_HOST", keyPath: "db/host", value: "prod-db", secret: false }
    ]);
  });

  it("marks template mapping secret when any referenced key is secret", () => {
    const mappings: AppMapping[] = [
      {
        envVar: "DB_URL",
        template: "${db/host}:${db/password}",
        keyPaths: ["db/host", "db/password"]
      }
    ];
    const resolved = new Map([
      ["db/host", "prod-db"],
      ["db/password", "s3cret"]
    ]);
    expect(buildJsonVars(mappings, schema, resolved)).toEqual([
      {
        envVar: "DB_URL",
        keyPath: null,
        value: "prod-db:s3cret",
        secret: true,
        template: true
      }
    ]);
  });

  it("template referencing only config keys is not marked secret", () => {
    const mappings: AppMapping[] = [
      { envVar: "DB_URL", template: "${db/host}", keyPaths: ["db/host"] }
    ];
    const resolved = new Map([["db/host", "prod-db"]]);
    expect(buildJsonVars(mappings, schema, resolved)).toEqual([
      {
        envVar: "DB_URL",
        keyPath: null,
        value: "prod-db",
        secret: false,
        template: true
      }
    ]);
  });

  it("warns about template references not in schema but still emits", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const mappings: AppMapping[] = [
      { envVar: "URL", template: "${unknown/path}", keyPaths: ["unknown/path"] }
    ];
    const result = buildJsonVars(mappings, schema, new Map());
    expect(result).toEqual([
      { envVar: "URL", keyPath: null, value: "", secret: false, template: true }
    ]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
