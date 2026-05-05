import { describe, it, expect } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AgeProvider } from "../../../src/providers/age.js";
import type { ProviderListContext } from "../../../src/providers/types.js";
import { shareCommonProviderTests, testRequiredConfigKey } from "./_shared.js";

describe("AgeProvider", () => {
  const state = shareCommonProviderTests({
    prefix: "keyshelf-age-",
    createProvider: () => new AgeProvider(),
    buildConfig: ({ tmpDir, identityFile }) => ({
      identityFile,
      secretsDir: `${tmpDir}/secrets`
    })
  });

  testRequiredConfigKey(state, "identityFile", () => ({
    secretsDir: `${state.tmpDir}/secrets`
  }));
  testRequiredConfigKey(state, "secretsDir", () => ({
    identityFile: state.identityFile
  }));

  it("resolve throws for missing secret", async () => {
    await expect(state.provider.resolve(state.ctx("missing/key"))).rejects.toThrow();
  });

  describe("list", () => {
    function listCtx(): ProviderListContext {
      return {
        rootDir: state.tmpDir,
        config: { identityFile: state.identityFile, secretsDir: `${state.tmpDir}/secrets` }
      };
    }

    it("returns empty array when secretsDir does not exist", async () => {
      expect(await state.provider.list(listCtx())).toEqual([]);
    });

    it("returns all stored keys with envName undefined", async () => {
      await state.provider.set(state.ctx("db/password"), "v1");
      await state.provider.set(state.ctx("api/token"), "v2");

      const result = await state.provider.list(listCtx());
      expect(result).toEqual(
        expect.arrayContaining([
          { keyPath: "db/password", envName: undefined },
          { keyPath: "api/token", envName: undefined }
        ])
      );
      expect(result).toHaveLength(2);
    });

    it("ignores non-.age files", async () => {
      await state.provider.set(state.ctx("db/password"), "v1");
      await writeFile(join(state.tmpDir, "secrets", "README.md"), "hi");

      const result = await state.provider.list(listCtx());
      expect(result).toEqual([{ keyPath: "db/password", envName: undefined }]);
    });

    it("requires secretsDir config", async () => {
      await expect(
        state.provider.list({
          rootDir: state.tmpDir,
          config: { identityFile: state.identityFile }
        })
      ).rejects.toThrow('age provider requires "secretsDir" config for list');
    });
  });
});
