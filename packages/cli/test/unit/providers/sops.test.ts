import { describe, it, expect } from "vitest";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { SopsProvider } from "../../../src/providers/sops.js";
import type { ProviderListContext } from "../../../src/providers/types.js";
import { shareCommonProviderTests, testRequiredConfigKey } from "./_shared.js";

describe("SopsProvider", () => {
  const state = shareCommonProviderTests({
    prefix: "keyshelf-sops-",
    createProvider: () => new SopsProvider(),
    buildConfig: ({ tmpDir, identityFile }) => ({
      identityFile,
      secretsFile: join(tmpDir, "secrets.json")
    })
  });

  testRequiredConfigKey(state, "identityFile", () => ({
    secretsFile: join(state.tmpDir, "secrets.json")
  }));
  testRequiredConfigKey(state, "secretsFile", () => ({
    identityFile: state.identityFile
  }));

  function secretsFilePath() {
    return join(state.tmpDir, "secrets.json");
  }

  it("stores all secrets in a single file", async () => {
    await state.provider.set(state.ctx("db/password"), "dbpass");
    await state.provider.set(state.ctx("api/key"), "apikey123");

    const content = JSON.parse(await readFile(secretsFilePath(), "utf-8"));
    expect(Object.keys(content.entries)).toEqual(
      expect.arrayContaining(["db/password", "api/key"])
    );
  });

  it("validate returns false for missing file", async () => {
    const missingCtx = {
      keyPath: "k",
      envName: "test",
      rootDir: state.tmpDir,
      config: { identityFile: state.identityFile, secretsFile: join(state.tmpDir, "nope.json") }
    };
    expect(await state.provider.validate(missingCtx)).toBe(false);
  });

  it("resolve throws for missing secret", async () => {
    await state.provider.set(state.ctx("other"), "val");
    await expect(state.provider.resolve(state.ctx("missing/key"))).rejects.toThrow(
      'secret "missing/key" not found'
    );
  });

  it("resolve throws for missing file", async () => {
    await expect(state.provider.resolve(state.ctx("missing/key"))).rejects.toThrow();
  });

  it("detects tampering via MAC", async () => {
    await state.provider.set(state.ctx("db/password"), "secret");

    const content = JSON.parse(await readFile(secretsFilePath(), "utf-8"));
    content.entries["db/password"].data = "dGFtcGVyZWQ=";
    await writeFile(secretsFilePath(), JSON.stringify(content));

    await expect(state.provider.resolve(state.ctx("db/password"))).rejects.toThrow(
      "MAC verification failed"
    );
  });

  it("detects key injection via MAC", async () => {
    await state.provider.set(state.ctx("db/password"), "secret");

    const content = JSON.parse(await readFile(secretsFilePath(), "utf-8"));
    content.entries["injected/key"] = {
      data: "ZmFrZQ==",
      iv: "AAAAAAAAAAAAAAAA",
      tag: "AAAAAAAAAAAAAAAAAAAAAA=="
    };
    await writeFile(secretsFilePath(), JSON.stringify(content));

    await expect(state.provider.resolve(state.ctx("db/password"))).rejects.toThrow(
      "MAC verification failed"
    );
  });

  describe("list", () => {
    function listCtx(): ProviderListContext {
      return {
        rootDir: state.tmpDir,
        config: { identityFile: state.identityFile, secretsFile: secretsFilePath() }
      };
    }

    it("returns empty array when secretsFile does not exist", async () => {
      expect(await state.provider.list(listCtx())).toEqual([]);
    });

    it("returns all stored keys with envName undefined", async () => {
      await state.provider.set(state.ctx("db/password"), "v1");
      await state.provider.set(state.ctx("api/key"), "v2");

      const result = await state.provider.list(listCtx());
      expect(result).toEqual(
        expect.arrayContaining([
          { keyPath: "db/password", envName: undefined },
          { keyPath: "api/key", envName: undefined }
        ])
      );
      expect(result).toHaveLength(2);
    });

    it("rejects tampered files via MAC verification", async () => {
      await state.provider.set(state.ctx("db/password"), "v1");
      const content = JSON.parse(await readFile(secretsFilePath(), "utf-8"));
      content.entries.injected = {
        data: "ZmFrZQ==",
        iv: "AAAAAAAAAAAAAAAA",
        tag: "AAAAAAAAAAAAAAAAAAAAAA=="
      };
      await writeFile(secretsFilePath(), JSON.stringify(content));

      await expect(state.provider.list(listCtx())).rejects.toThrow("MAC verification failed");
    });

    it("requires identityFile config", async () => {
      await expect(
        state.provider.list({
          rootDir: state.tmpDir,
          config: { secretsFile: secretsFilePath() }
        })
      ).rejects.toThrow('sops provider requires "identityFile" config for list');
    });
  });

  describe("copy", () => {
    it("copies the encrypted entry under a new key, preserving the source", async () => {
      await state.provider.set(state.ctx("old/path"), "value-x");
      await state.provider.copy(state.ctx("old/path"), state.ctx("new/path"));

      expect(await state.provider.resolve(state.ctx("new/path"))).toBe("value-x");
      expect(await state.provider.resolve(state.ctx("old/path"))).toBe("value-x");
    });

    it("re-MACs after copy so list/resolve still validate", async () => {
      await state.provider.set(state.ctx("a"), "v1");
      await state.provider.copy(state.ctx("a"), state.ctx("b"));
      // resolve verifies the MAC; if it weren't recomputed this would throw.
      expect(await state.provider.resolve(state.ctx("b"))).toBe("v1");
    });

    it("throws when source key is absent", async () => {
      await state.provider.set(state.ctx("only"), "v");
      await expect(
        state.provider.copy(state.ctx("missing"), state.ctx("destination"))
      ).rejects.toThrow('source key "missing" not found');
    });
  });

  describe("delete", () => {
    it("removes the entry and re-MACs", async () => {
      await state.provider.set(state.ctx("a"), "v1");
      await state.provider.set(state.ctx("b"), "v2");
      await state.provider.delete(state.ctx("a"));

      expect(await state.provider.validate(state.ctx("a"))).toBe(false);
      // MAC must remain valid for the surviving entry.
      expect(await state.provider.resolve(state.ctx("b"))).toBe("v2");
    });

    it("is idempotent on missing entry", async () => {
      await state.provider.set(state.ctx("a"), "v1");
      await expect(state.provider.delete(state.ctx("never"))).resolves.toBeUndefined();
    });

    it("is idempotent on missing file", async () => {
      const ctx = {
        keyPath: "k",
        envName: "test",
        rootDir: state.tmpDir,
        config: { identityFile: state.identityFile, secretsFile: join(state.tmpDir, "nope.json") }
      };
      await expect(state.provider.delete(ctx)).resolves.toBeUndefined();
    });
  });
});
