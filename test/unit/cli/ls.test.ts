import { describe, it, expect } from "vitest";
import { describeSource } from "../../../src/cli/ls.js";
import type { KeyDefinition } from "../../../src/config/schema.js";
import type { EnvConfig } from "../../../src/config/environment.js";

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
