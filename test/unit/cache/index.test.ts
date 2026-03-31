import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readdir, stat, utimes, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SecretCache } from "../../../src/cache/index.js";

describe("SecretCache", () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), "keyshelf-cache-test-"));
  });

  it("returns undefined on cache miss", async () => {
    const cache = new SecretCache({ cacheDir, ttl: 3600 });
    const result = await cache.get("dev", "db/password");
    expect(result).toBeUndefined();
  });

  it("encrypts, stores, and retrieves a value", async () => {
    const cache = new SecretCache({ cacheDir, ttl: 3600 });
    await cache.set("dev", "db/password", "my-secret");
    const result = await cache.get("dev", "db/password");
    expect(result).toBe("my-secret");
  });

  it("stores values in separate env directories", async () => {
    const cache = new SecretCache({ cacheDir, ttl: 3600 });
    await cache.set("dev", "db/password", "dev-secret");
    await cache.set("staging", "db/password", "staging-secret");

    expect(await cache.get("dev", "db/password")).toBe("dev-secret");
    expect(await cache.get("staging", "db/password")).toBe("staging-secret");
  });

  it("auto-generates identity file on first use", async () => {
    const cache = new SecretCache({ cacheDir, ttl: 3600 });
    await cache.set("dev", "key", "value");

    const identityPath = join(cacheDir, "identity.txt");
    const identityStat = await stat(identityPath);
    expect(identityStat.isFile()).toBe(true);
    // Check file permissions (owner-only read/write)
    expect(identityStat.mode & 0o777).toBe(0o600);
  });

  it("reuses existing identity across instances", async () => {
    const cache1 = new SecretCache({ cacheDir, ttl: 3600 });
    await cache1.set("dev", "key", "value");

    const cache2 = new SecretCache({ cacheDir, ttl: 3600 });
    const result = await cache2.get("dev", "key");
    expect(result).toBe("value");
  });

  it("returns undefined for expired entries", async () => {
    const cache = new SecretCache({ cacheDir, ttl: 60 });
    await cache.set("dev", "key", "value");

    // Backdate the file's mtime by 120 seconds to simulate expiry
    const filePath = join(cacheDir, "dev", "key.age");
    const past = new Date(Date.now() - 120_000);
    await utimes(filePath, past, past);

    const result = await cache.get("dev", "key");
    expect(result).toBeUndefined();
  });

  it("returns undefined for corrupt cache entries", async () => {
    const cache = new SecretCache({ cacheDir, ttl: 3600 });
    // Write a valid entry first to generate the identity
    await cache.set("dev", "good", "value");

    // Write garbage to a cache file
    const corruptPath = join(cacheDir, "dev", "bad.age");
    await writeFile(corruptPath, "not-valid-age-ciphertext");

    const result = await cache.get("dev", "bad");
    expect(result).toBeUndefined();
  });

  it("creates .age files on disk", async () => {
    const cache = new SecretCache({ cacheDir, ttl: 3600 });
    await cache.set("dev", "db/password", "secret");

    const files = await readdir(join(cacheDir, "dev"));
    expect(files).toContain("db_password.age");
  });
});
