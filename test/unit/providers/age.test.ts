import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { AgeProvider, generateIdentity } from "../../../src/providers/age.js";

describe("AgeProvider", () => {
  let tmpDir: string;
  let identityFile: string;
  let secretsDir: string;
  let provider: AgeProvider;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "keyshelf-age-"));
    identityFile = join(tmpDir, "key.txt");
    secretsDir = join(tmpDir, "secrets");

    const identity = await generateIdentity();
    await writeFile(identityFile, identity);

    provider = new AgeProvider();
  });

  function ctx(keyPath: string) {
    return { keyPath, envName: "test", rootDir: tmpDir, config: { identityFile, secretsDir } };
  }

  it("roundtrips set + resolve", async () => {
    await provider.set(ctx("db/password"), "supersecret");
    const result = await provider.resolve(ctx("db/password"));
    expect(result).toBe("supersecret");
  });

  it("roundtrips multiple keys", async () => {
    await provider.set(ctx("db/password"), "dbpass");
    await provider.set(ctx("api/key"), "apikey123");

    expect(await provider.resolve(ctx("db/password"))).toBe("dbpass");
    expect(await provider.resolve(ctx("api/key"))).toBe("apikey123");
  });

  it("overwrites existing secret", async () => {
    await provider.set(ctx("db/password"), "old");
    await provider.set(ctx("db/password"), "new");
    expect(await provider.resolve(ctx("db/password"))).toBe("new");
  });

  it("validate returns true for existing secret", async () => {
    await provider.set(ctx("db/password"), "value");
    expect(await provider.validate(ctx("db/password"))).toBe(true);
  });

  it("validate returns false for missing secret", async () => {
    expect(await provider.validate(ctx("missing/key"))).toBe(false);
  });

  it("resolve throws for missing secret", async () => {
    await expect(provider.resolve(ctx("missing/key"))).rejects.toThrow();
  });

  it("throws when identityFile is missing from config", async () => {
    await expect(
      provider.resolve({
        keyPath: "k",
        envName: "test",
        rootDir: tmpDir,
        config: { secretsDir }
      })
    ).rejects.toThrow("identityFile");
  });

  it("throws when secretsDir is missing from config", async () => {
    await expect(
      provider.resolve({
        keyPath: "k",
        envName: "test",
        rootDir: tmpDir,
        config: { identityFile }
      })
    ).rejects.toThrow("secretsDir");
  });

  it("handles empty string values", async () => {
    await provider.set(ctx("empty"), "");
    expect(await provider.resolve(ctx("empty"))).toBe("");
  });

  it("handles special characters", async () => {
    const special = 'p@$$w0rd!#%^&*()_+{}|:"<>?`~';
    await provider.set(ctx("special"), special);
    expect(await provider.resolve(ctx("special"))).toBe(special);
  });

  it("expands ~ in identityFile and secretsDir", async () => {
    const home = homedir();
    const relIdentity = identityFile.replace(home, "~");
    const relSecrets = secretsDir.replace(home, "~");

    // only run when tmpdir is under home (true on macOS/Linux)
    if (!identityFile.startsWith(home)) return;

    const tildeCtx = {
      keyPath: "tilde/test",
      envName: "test",
      rootDir: tmpDir,
      config: { identityFile: relIdentity, secretsDir: relSecrets }
    };

    await provider.set(tildeCtx, "tilde-value");
    expect(await provider.resolve(tildeCtx)).toBe("tilde-value");
  });
});
