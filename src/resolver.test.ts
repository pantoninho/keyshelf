import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { generateKeyPair, ageProvider } from "@/providers/age";
import { keyToEnvVar, resolveValue, resolveAllKeys, PROVIDERS, buildProviders } from "@/resolver";
import type { KeyshelfSchema, ProviderContext } from "@/types";

const TEST_PROJECT = `keyshelf-resolver-test-${Date.now()}`;
let publicKey: string;

beforeAll(async () => {
  publicKey = await generateKeyPair(TEST_PROJECT);
});

afterAll(async () => {
  const projectDir = join(homedir(), ".config", "keyshelf", TEST_PROJECT);
  await rm(projectDir, { recursive: true, force: true });
});

describe("keyToEnvVar", () => {
  it("converts slashes and dashes to underscores, uppercased", () => {
    expect(keyToEnvVar("database/url")).toBe("DATABASE_URL");
    expect(keyToEnvVar("api/secret-key")).toBe("API_SECRET_KEY");
    expect(keyToEnvVar("simple")).toBe("SIMPLE");
  });

  it("converts dots and spaces to underscores", () => {
    expect(keyToEnvVar("api.key")).toBe("API_KEY");
    expect(keyToEnvVar("my app/secret key")).toBe("MY_APP_SECRET_KEY");
  });
});

describe("resolveAllKeys", () => {
  it("resolves plain string values as-is", async () => {
    const schema: KeyshelfSchema = {
      project: TEST_PROJECT,
      publicKey,
      keys: {
        "database/url": { default: "postgres://localhost/db" }
      }
    };

    const result = await resolveAllKeys(schema, "default");
    expect(result).toEqual({ DATABASE_URL: "postgres://localhost/db" });
  });

  it("resolves encrypted values through the age provider", async () => {
    const context: ProviderContext = {
      projectName: TEST_PROJECT,
      publicKey,
      keyPath: "api/key",
      env: "default"
    };
    const encrypted = await ageProvider.set!("my-secret", context);

    const schema: KeyshelfSchema = {
      project: TEST_PROJECT,
      publicKey,
      keys: {
        "api/key": { default: { _tag: "!age", value: encrypted } }
      }
    };

    const result = await resolveAllKeys(schema, "default");
    expect(result).toEqual({ API_KEY: "my-secret" });
  });

  it("picks environment-specific value over default", async () => {
    const schema: KeyshelfSchema = {
      project: TEST_PROJECT,
      publicKey,
      keys: {
        "database/url": {
          default: "postgres://localhost/db",
          staging: "postgres://staging-host/db"
        }
      }
    };

    const result = await resolveAllKeys(schema, "staging");
    expect(result).toEqual({ DATABASE_URL: "postgres://staging-host/db" });
  });

  it("falls back to default when env-specific value is missing", async () => {
    const schema: KeyshelfSchema = {
      project: TEST_PROJECT,
      publicKey,
      keys: {
        "database/url": { default: "postgres://localhost/db" }
      }
    };

    const result = await resolveAllKeys(schema, "staging");
    expect(result).toEqual({ DATABASE_URL: "postgres://localhost/db" });
  });

  it("returns empty record when schema has no keys", async () => {
    const schema: KeyshelfSchema = {
      project: TEST_PROJECT,
      publicKey,
      keys: {}
    };
    const result = await resolveAllKeys(schema, "default");
    expect(result).toEqual({});
  });

  it("throws when key has no value for env and no default", async () => {
    const schema: KeyshelfSchema = {
      project: TEST_PROJECT,
      publicKey,
      keys: {
        "api/key": { staging: "only-staging" }
      }
    };

    await expect(resolveAllKeys(schema, "prod")).rejects.toThrow(
      "Key 'api/key' has no value for env 'prod' and no default"
    );
  });
});

describe("resolveValue", () => {
  it("passes plain strings through unchanged", async () => {
    const context: ProviderContext = {
      projectName: TEST_PROJECT,
      publicKey,
      keyPath: "test/key",
      env: "default"
    };

    const result = await resolveValue("plain-value", context);
    expect(result).toBe("plain-value");
  });

  it("throws for an unknown provider tag", async () => {
    const context: ProviderContext = {
      projectName: TEST_PROJECT,
      publicKey,
      keyPath: "test/key",
      env: "default"
    };

    await expect(resolveValue({ _tag: "!unknown", value: "ref" }, context)).rejects.toThrow(
      "Unknown provider '!unknown'"
    );
  });
});

describe("PROVIDERS", () => {
  it("registers entries for all three provider tags", () => {
    expect(Object.keys(PROVIDERS)).toContain("!age");
    expect(Object.keys(PROVIDERS)).toContain("!awssm");
    expect(Object.keys(PROVIDERS)).toContain("!gcsm");
  });
});

describe("buildProviders", () => {
  it("returns static providers when schema has no pulumi config", () => {
    const schema = { project: "test", keys: {} };
    const providers = buildProviders(schema);
    expect(providers["!pulumi"]).toBeUndefined();
    expect(providers["!age"]).toBeDefined();
  });

  it("includes pulumi provider when schema has pulumi config", () => {
    const schema = { project: "test", pulumi: { cwd: "./infra" }, keys: {} };
    const providers = buildProviders(schema);
    expect(providers["!pulumi"]).toBeDefined();
    expect(providers["!pulumi"].get).toBeInstanceOf(Function);
    expect(providers["!pulumi"].set).toBeUndefined();
  });
});
