import { describe, expect, it } from "vitest";
import { KeyshelfError } from "../../src/errors.js";
import type { Config, Environment, LoadedEnvironment, Schema } from "../../src/model.js";
import { validateEnvironment } from "../../src/validate.js";

const config: Config = {
  project: "myapp",
  providers: { local: { adapter: "sops" }, "gcp-staging": { adapter: "gcp", projectId: "p" } }
};

const schema: Schema = {
  keys: {
    LOG_LEVEL: { kind: "config", default: "info" },
    REGION: { kind: "required" },
    FEATURE_X: { kind: "optional" },
    DATABASE_PASSWORD: { kind: "required" }
  }
};

function env(overrides: Partial<Environment> = {}): Environment {
  return {
    shelf: "web",
    name: "staging",
    provider: "local",
    keys: {
      REGION: { kind: "config", value: "eu-west-1" },
      DATABASE_PASSWORD: { kind: "secret" }
    },
    ...overrides
  };
}

function loaded(environment: Environment): LoadedEnvironment {
  return { config, schema, environment };
}

describe("validateEnvironment", () => {
  it("passes a well-formed environment (returns no errors)", () => {
    expect(() => validateEnvironment(loaded(env()))).not.toThrow();
  });

  it("does not require restating defaulted config keys", () => {
    // LOG_LEVEL has a default and FEATURE_X is optional; both omitted is fine.
    expect(() => validateEnvironment(loaded(env()))).not.toThrow();
  });

  it("allows an optional key to be absent", () => {
    // FEATURE_X is !optional and not supplied — still valid.
    expect(() => validateEnvironment(loaded(env()))).not.toThrow();
  });

  it("accepts a !secret value structurally without resolving it", () => {
    const e = env({
      keys: {
        REGION: { kind: "config", value: "eu" },
        DATABASE_PASSWORD: { kind: "secret", ref: { ref: "x" } }
      }
    });
    expect(() => validateEnvironment(loaded(e))).not.toThrow();
  });

  function expectCode(fn: () => void, code: string, fields?: Record<string, unknown>): void {
    let thrown: unknown;
    try {
      fn();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(KeyshelfError);
    const err = thrown as KeyshelfError;
    expect(err.code).toBe(code);
    if (fields) expect(err.fields).toMatchObject(fields);
  }

  it("rejects a key not declared in the schema with UNKNOWN_KEY", () => {
    const e = env({ keys: { ...env().keys, EXTRA: { kind: "config", value: "x" } } });
    expectCode(() => validateEnvironment(loaded(e)), "UNKNOWN_KEY", {
      key: "EXTRA",
      environment: "web/staging"
    });
  });

  it("rejects a missing !required key with MISSING_REQUIRED", () => {
    const e = env({ keys: { REGION: { kind: "config", value: "eu" } } }); // DATABASE_PASSWORD missing
    expectCode(() => validateEnvironment(loaded(e)), "MISSING_REQUIRED", {
      key: "DATABASE_PASSWORD"
    });
  });

  it("rejects an invalid env-var key name with INVALID_KEY_NAME", () => {
    const e = env({ keys: { ...env().keys, "bad-key": { kind: "config", value: "x" } } });
    expectCode(() => validateEnvironment(loaded(e)), "INVALID_KEY_NAME", { key: "bad-key" });
  });

  it("rejects a lowercase-leading key name with INVALID_KEY_NAME", () => {
    const e = env({ keys: { ...env().keys, region: { kind: "config", value: "x" } } });
    expectCode(() => validateEnvironment(loaded(e)), "INVALID_KEY_NAME", { key: "region" });
  });

  it("rejects a digit-leading key name with INVALID_KEY_NAME", () => {
    const e = env({ keys: { ...env().keys, "1ST": { kind: "config", value: "x" } } });
    expectCode(() => validateEnvironment(loaded(e)), "INVALID_KEY_NAME", { key: "1ST" });
  });

  it("rejects an undefined provider reference with PROVIDER_NOT_FOUND", () => {
    const e = env({ provider: "nope" });
    expectCode(() => validateEnvironment(loaded(e)), "PROVIDER_NOT_FOUND", { provider: "nope" });
  });

  it("still requires a provider when a local !secret is declared", () => {
    // A local !secret with no provider has nowhere to resolve from.
    const e = env({
      provider: undefined,
      keys: {
        REGION: { kind: "config", value: "eu" },
        DATABASE_PASSWORD: { kind: "secret" }
      }
    });
    expectCode(() => validateEnvironment(loaded(e)), "PROVIDER_NOT_FOUND");
  });

  it("allows a config-only environment to omit the provider", () => {
    // No local !secret, so no provider is needed (mapping/config-only environment).
    const e = env({
      provider: undefined,
      keys: {
        REGION: { kind: "config", value: "eu" },
        DATABASE_PASSWORD: { kind: "config", value: "plain" }
      }
    });
    expect(() => validateEnvironment(loaded(e))).not.toThrow();
  });

  it("allows a !ref-only mapping environment to omit the provider", () => {
    // Every key is config and/or a key reference; each !ref resolves through its
    // target's provider, so a local provider would never be used.
    const e = env({
      provider: undefined,
      keys: {
        REGION: { kind: "config", value: "eu" },
        DATABASE_PASSWORD: { kind: "ref", reference: { shelf: "shared" } }
      }
    });
    expect(() => validateEnvironment(loaded(e))).not.toThrow();
  });

  it("still validates an undefined provider name when a local !secret is declared", () => {
    const e = env({ provider: "nope" });
    expectCode(() => validateEnvironment(loaded(e)), "PROVIDER_NOT_FOUND", { provider: "nope" });
  });
});
