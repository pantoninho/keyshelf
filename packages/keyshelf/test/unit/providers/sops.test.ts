import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { SopsProvider } from "../../../src/providers/sops.js";
import { generateIdentity } from "../../../src/providers/age.js";

describe("SopsProvider", () => {
  let tmpDir: string;
  let identityFile: string;
  let secretsFile: string;
  let provider: SopsProvider;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "keyshelf-sops-"));
    identityFile = join(tmpDir, "key.txt");
    secretsFile = join(tmpDir, "secrets.json");

    const identity = await generateIdentity();
    await writeFile(identityFile, identity);

    provider = new SopsProvider();
  });

  function ctx(keyPath: string) {
    return { keyPath, envName: "test", rootDir: tmpDir, config: { identityFile, secretsFile } };
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

  it("stores all secrets in a single file", async () => {
    await provider.set(ctx("db/password"), "dbpass");
    await provider.set(ctx("api/key"), "apikey123");

    const content = JSON.parse(await readFile(secretsFile, "utf-8"));
    expect(Object.keys(content.entries)).toEqual(
      expect.arrayContaining(["db/password", "api/key"])
    );
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

  it("validate returns false for missing file", async () => {
    const missingCtx = {
      keyPath: "k",
      envName: "test",
      rootDir: tmpDir,
      config: { identityFile, secretsFile: join(tmpDir, "nope.json") }
    };
    expect(await provider.validate(missingCtx)).toBe(false);
  });

  it("resolve throws for missing secret", async () => {
    await provider.set(ctx("other"), "val");
    await expect(provider.resolve(ctx("missing/key"))).rejects.toThrow(
      'secret "missing/key" not found'
    );
  });

  it("resolve throws for missing file", async () => {
    await expect(provider.resolve(ctx("missing/key"))).rejects.toThrow();
  });

  it("throws when identityFile is missing from config", async () => {
    await expect(
      provider.resolve({
        keyPath: "k",
        envName: "test",
        rootDir: tmpDir,
        config: { secretsFile }
      })
    ).rejects.toThrow("identityFile");
  });

  it("throws when secretsFile is missing from config", async () => {
    await expect(
      provider.resolve({
        keyPath: "k",
        envName: "test",
        rootDir: tmpDir,
        config: { identityFile }
      })
    ).rejects.toThrow("secretsFile");
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

  it("detects tampering via MAC", async () => {
    await provider.set(ctx("db/password"), "secret");

    const content = JSON.parse(await readFile(secretsFile, "utf-8"));
    content.entries["db/password"].data = "dGFtcGVyZWQ="; // "tampered" in base64
    await writeFile(secretsFile, JSON.stringify(content));

    await expect(provider.resolve(ctx("db/password"))).rejects.toThrow("MAC verification failed");
  });

  it("detects key injection via MAC", async () => {
    await provider.set(ctx("db/password"), "secret");

    const content = JSON.parse(await readFile(secretsFile, "utf-8"));
    content.entries["injected/key"] = {
      data: "ZmFrZQ==",
      iv: "AAAAAAAAAAAAAAAA",
      tag: "AAAAAAAAAAAAAAAAAAAAAA=="
    };
    await writeFile(secretsFile, JSON.stringify(content));

    await expect(provider.resolve(ctx("db/password"))).rejects.toThrow("MAC verification failed");
  });

  it("expands ~ in identityFile and secretsFile", async () => {
    const home = homedir();
    const relIdentity = identityFile.replace(home, "~");
    const relSecrets = secretsFile.replace(home, "~");

    if (!identityFile.startsWith(home)) return;

    const tildeCtx = {
      keyPath: "tilde/test",
      envName: "test",
      rootDir: tmpDir,
      config: { identityFile: relIdentity, secretsFile: relSecrets }
    };

    await provider.set(tildeCtx, "tilde-value");
    expect(await provider.resolve(tildeCtx)).toBe("tilde-value");
  });
});
