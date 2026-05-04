import { describe, it, expect } from "vitest";
import { AgeProvider } from "../../../src/providers/age.js";
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
});
