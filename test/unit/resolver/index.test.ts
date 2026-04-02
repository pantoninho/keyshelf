import { describe, it, expect, vi } from "vitest";
import { resolve, validate } from "../../../src/resolver/index.js";
import { ProviderRegistry } from "../../../src/providers/registry.js";
import type { Provider } from "../../../src/providers/types.js";
import type { KeyDefinition } from "../../../src/config/schema.js";
import type { EnvConfig } from "../../../src/config/environment.js";

function mockProvider(name: string, resolveValue = "provider-value"): Provider {
  return {
    name,
    resolve: vi.fn().mockResolvedValue(resolveValue),
    validate: vi.fn().mockResolvedValue(true),
    set: vi.fn().mockResolvedValue(undefined)
  };
}

function makeRegistry(...providers: Provider[]): ProviderRegistry {
  const registry = new ProviderRegistry();
  for (const p of providers) registry.register(p);
  return registry;
}

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

describe("resolve", () => {
  it("resolves plaintext env override", async () => {
    const env: EnvConfig = {
      overrides: { "db/host": "prod-db" }
    };
    const result = await resolve({
      envName: "test",
      schema: [configKey("db/host", "localhost")],
      env,
      registry: makeRegistry()
    });
    expect(result).toEqual([{ path: "db/host", value: "prod-db" }]);
  });

  it("resolves schema default when no override", async () => {
    const env: EnvConfig = { overrides: {} };
    const result = await resolve({
      envName: "test",
      schema: [configKey("db/host", "localhost")],
      env,
      registry: makeRegistry()
    });
    expect(result).toEqual([{ path: "db/host", value: "localhost" }]);
  });

  it("resolves provider-tagged override", async () => {
    const gcp = mockProvider("gcp", "gcp-secret");
    const env: EnvConfig = {
      overrides: {
        "db/password": { tag: "gcp", config: { name: "db-pass" } }
      }
    };
    const result = await resolve({
      envName: "test",
      schema: [secretKey("db/password")],
      env,
      registry: makeRegistry(gcp)
    });
    expect(result).toEqual([{ path: "db/password", value: "gcp-secret" }]);
    expect(gcp.resolve).toHaveBeenCalledWith({
      envName: "test",
      keyPath: "db/password",
      config: { name: "db-pass" }
    });
  });

  it("merges env-level provider config with per-key config", async () => {
    const gcp = mockProvider("gcp", "secret");
    const env: EnvConfig = {
      defaultProvider: { name: "gcp", options: { project: "my-proj" } },
      overrides: {
        "db/password": { tag: "gcp", config: { name: "custom" } }
      }
    };
    await resolve({
      envName: "test",
      schema: [secretKey("db/password")],
      env,
      registry: makeRegistry(gcp)
    });
    expect(gcp.resolve).toHaveBeenCalledWith({
      envName: "test",
      keyPath: "db/password",
      config: { project: "my-proj", name: "custom" }
    });
  });

  it("per-key config overrides env-level config", async () => {
    const gcp = mockProvider("gcp", "secret");
    const env: EnvConfig = {
      defaultProvider: { name: "gcp", options: { project: "default" } },
      overrides: {
        "db/password": {
          tag: "gcp",
          config: { project: "override" }
        }
      }
    };
    await resolve({
      envName: "test",
      schema: [secretKey("db/password")],
      env,
      registry: makeRegistry(gcp)
    });
    expect(gcp.resolve).toHaveBeenCalledWith({
      envName: "test",
      keyPath: "db/password",
      config: { project: "override" }
    });
  });

  it("resolves secret via default provider when no explicit override", async () => {
    const gcp = mockProvider("gcp", "default-secret");
    const env: EnvConfig = {
      defaultProvider: { name: "gcp", options: { project: "my-proj" } },
      overrides: {}
    };
    const result = await resolve({
      envName: "test",
      schema: [secretKey("db/password")],
      env,
      registry: makeRegistry(gcp)
    });
    expect(result).toEqual([{ path: "db/password", value: "default-secret" }]);
    expect(gcp.resolve).toHaveBeenCalledWith({
      envName: "test",
      keyPath: "db/password",
      config: { project: "my-proj" }
    });
  });

  it("throws for required secret with no provider and no override", async () => {
    const env: EnvConfig = { overrides: {} };
    await expect(
      resolve({
        envName: "test",
        schema: [secretKey("db/password")],
        env,
        registry: makeRegistry()
      })
    ).rejects.toThrow('No value for required key "db/password"');
  });

  it("skips optional secret with no provider and no override", async () => {
    const env: EnvConfig = { overrides: {} };
    const result = await resolve({
      envName: "test",
      schema: [secretKey("db/password", true)],
      env,
      registry: makeRegistry()
    });
    expect(result).toEqual([]);
  });

  it("throws for required config with no default and no override", async () => {
    const env: EnvConfig = { overrides: {} };
    await expect(
      resolve({
        envName: "test",
        schema: [configKey("db/host")],
        env,
        registry: makeRegistry()
      })
    ).rejects.toThrow('No value for required key "db/host"');
  });

  it("resolves multiple keys in order", async () => {
    const gcp = mockProvider("gcp", "secret-val");
    const env: EnvConfig = {
      defaultProvider: { name: "gcp", options: {} },
      overrides: { "db/host": "prod-db" }
    };
    const result = await resolve({
      envName: "test",
      schema: [
        configKey("db/host", "localhost"),
        secretKey("db/password"),
        configKey("db/port", "5432")
      ],
      env,
      registry: makeRegistry(gcp)
    });
    expect(result).toEqual([
      { path: "db/host", value: "prod-db" },
      { path: "db/password", value: "secret-val" },
      { path: "db/port", value: "5432" }
    ]);
  });

  it("plaintext override takes precedence over schema default", async () => {
    const env: EnvConfig = {
      overrides: { "db/port": 3306 as unknown as string }
    };
    const result = await resolve({
      envName: "test",
      schema: [configKey("db/port", "5432")],
      env,
      registry: makeRegistry()
    });
    expect(result).toEqual([{ path: "db/port", value: "3306" }]);
  });

  it("does not use schema default for secrets", async () => {
    const env: EnvConfig = { overrides: {} };
    await expect(
      resolve({
        envName: "test",
        schema: [
          {
            path: "key",
            isSecret: true,
            optional: false,
            defaultValue: "nope"
          }
        ],
        env,
        registry: makeRegistry()
      })
    ).rejects.toThrow('No value for required key "key"');
  });

  it("does not merge env-level config for different provider", async () => {
    const aws = mockProvider("aws", "aws-secret");
    const env: EnvConfig = {
      defaultProvider: { name: "gcp", options: { project: "gcp-proj" } },
      overrides: {
        key: { tag: "aws", config: { region: "us-east-1" } }
      }
    };
    await resolve({
      envName: "test",
      schema: [secretKey("key")],
      env,
      registry: makeRegistry(aws)
    });
    expect(aws.resolve).toHaveBeenCalledWith({
      envName: "test",
      keyPath: "key",
      config: { region: "us-east-1" }
    });
  });

  it("resolves optional secret with explicit plaintext override", async () => {
    const env: EnvConfig = {
      overrides: { "db/password": "explicit-value" }
    };
    const result = await resolve({
      envName: "test",
      schema: [secretKey("db/password", true)],
      env,
      registry: makeRegistry()
    });
    expect(result).toEqual([{ path: "db/password", value: "explicit-value" }]);
  });

  it("skips optional secret when default provider rejects", async () => {
    const gcp = mockProvider("gcp");
    (gcp.resolve as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("NOT_FOUND: Secret not found")
    );
    const env: EnvConfig = {
      defaultProvider: { name: "gcp", options: { project: "my-proj" } },
      overrides: {}
    };
    const result = await resolve({
      envName: "test",
      schema: [secretKey("pulumi/config-passphrase", true)],
      env,
      registry: makeRegistry(gcp)
    });
    expect(result).toEqual([]);
  });

  it("throws for required secret when default provider rejects", async () => {
    const gcp = mockProvider("gcp");
    (gcp.resolve as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("NOT_FOUND: Secret not found")
    );
    const env: EnvConfig = {
      defaultProvider: { name: "gcp", options: { project: "my-proj" } },
      overrides: {}
    };
    await expect(
      resolve({
        envName: "test",
        schema: [secretKey("db/password")],
        env,
        registry: makeRegistry(gcp)
      })
    ).rejects.toThrow("NOT_FOUND: Secret not found");
  });

  it("skips optional secret when provider-tagged override rejects", async () => {
    const gcp = mockProvider("gcp");
    (gcp.resolve as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("NOT_FOUND: Secret not found")
    );
    const env: EnvConfig = {
      overrides: {
        "db/password": { tag: "gcp", config: { name: "missing-secret" } }
      }
    };
    const result = await resolve({
      envName: "test",
      schema: [secretKey("db/password", true)],
      env,
      registry: makeRegistry(gcp)
    });
    expect(result).toEqual([]);
  });

  it("resolves config key with provider-tagged override", async () => {
    const gcp = mockProvider("gcp", "from-provider");
    const env: EnvConfig = {
      overrides: {
        "app/name": { tag: "gcp", config: { name: "app-name" } }
      }
    };
    const result = await resolve({
      envName: "test",
      schema: [configKey("app/name", "default-app")],
      env,
      registry: makeRegistry(gcp)
    });
    expect(result).toEqual([{ path: "app/name", value: "from-provider" }]);
  });
});

describe("validate", () => {
  it("returns empty array when all keys resolve", async () => {
    const env: EnvConfig = {
      overrides: { "db/host": "localhost" }
    };
    const errors = await validate({
      envName: "test",
      schema: [configKey("db/host", "default")],
      env,
      registry: makeRegistry()
    });
    expect(errors).toEqual([]);
  });

  it("collects all errors instead of failing on first", async () => {
    const env: EnvConfig = { overrides: {} };
    const errors = await validate({
      envName: "test",
      schema: [secretKey("db/password"), secretKey("api/key"), configKey("db/host", "localhost")],
      env,
      registry: makeRegistry()
    });
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({
      path: "db/password",
      message: 'No value for required key "db/password"'
    });
    expect(errors[0].error).toBeInstanceOf(Error);
    expect(errors[1]).toMatchObject({
      path: "api/key",
      message: 'No value for required key "api/key"'
    });
    expect(errors[1].error).toBeInstanceOf(Error);
  });

  it("skips optional secrets without error", async () => {
    const env: EnvConfig = { overrides: {} };
    const errors = await validate({
      envName: "test",
      schema: [secretKey("optional/key", true)],
      env,
      registry: makeRegistry()
    });
    expect(errors).toEqual([]);
  });

  it("preserves original error object in validation errors", async () => {
    const originalError = new Error("something went wrong");
    const gcp = mockProvider("gcp");
    (gcp.resolve as ReturnType<typeof vi.fn>).mockRejectedValue(originalError);
    const env: EnvConfig = {
      defaultProvider: { name: "gcp", options: { project: "my-proj" } },
      overrides: {}
    };
    const errors = await validate({
      envName: "test",
      schema: [secretKey("db/password")],
      env,
      registry: makeRegistry(gcp)
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toBe(originalError);
  });
});
