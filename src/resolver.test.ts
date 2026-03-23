import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { generateKeyPair, ageProvider } from "@/providers/age";
import {
  keyToEnvVar,
  resolveValue,
  resolveAllKeys,
  resolveMappedKeys,
  PROVIDERS
} from "@/resolver";
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

describe("resolveMappedKeys", () => {
  it("resolves mapped keys with custom env var names", async () => {
    const schema: KeyshelfSchema = {
      project: TEST_PROJECT,
      publicKey,
      keys: {
        "database/url": { default: "postgres://localhost/db" },
        "api/key": { default: "secret-123" }
      }
    };
    const mapping = { DB_CONNECTION: "database/url", MY_API_KEY: "api/key" };

    const result = await resolveMappedKeys(schema, "default", mapping);
    expect(result).toEqual({
      DB_CONNECTION: "postgres://localhost/db",
      MY_API_KEY: "secret-123"
    });
  });

  it("only returns mapped keys, not all schema keys", async () => {
    const schema: KeyshelfSchema = {
      project: TEST_PROJECT,
      publicKey,
      keys: {
        "database/url": { default: "postgres://localhost/db" },
        "api/key": { default: "secret-123" }
      }
    };
    const mapping = { DB_CONNECTION: "database/url" };

    const result = await resolveMappedKeys(schema, "default", mapping);
    expect(Object.keys(result)).toEqual(["DB_CONNECTION"]);
  });

  it("picks env-specific value over default", async () => {
    const schema: KeyshelfSchema = {
      project: TEST_PROJECT,
      publicKey,
      keys: {
        "database/url": { default: "postgres://localhost/db", staging: "postgres://staging/db" }
      }
    };
    const mapping = { DB_URL: "database/url" };

    const result = await resolveMappedKeys(schema, "staging", mapping);
    expect(result).toEqual({ DB_URL: "postgres://staging/db" });
  });

  it("falls back to default when env value is missing", async () => {
    const schema: KeyshelfSchema = {
      project: TEST_PROJECT,
      publicKey,
      keys: {
        "database/url": { default: "postgres://localhost/db" }
      }
    };
    const mapping = { DB_URL: "database/url" };

    const result = await resolveMappedKeys(schema, "staging", mapping);
    expect(result).toEqual({ DB_URL: "postgres://localhost/db" });
  });

  it("throws when key path is not in schema", async () => {
    const schema: KeyshelfSchema = {
      project: TEST_PROJECT,
      publicKey,
      keys: {}
    };
    const mapping = { DB_URL: "database/url" };

    await expect(resolveMappedKeys(schema, "default", mapping)).rejects.toThrow(
      "Key 'database/url' referenced in .env.keyshelf not found in keyshelf.yaml"
    );
  });

  it("throws when key has no value for env and no default", async () => {
    const schema: KeyshelfSchema = {
      project: TEST_PROJECT,
      publicKey,
      keys: {
        "api/key": { staging: "only-staging" }
      }
    };
    const mapping = { MY_KEY: "api/key" };

    await expect(resolveMappedKeys(schema, "prod", mapping)).rejects.toThrow(
      "Key 'api/key' has no value for env 'prod' and no default"
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
