import { describe, it, expect } from "vitest";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { SopsProvider } from "../../../src/providers/sops.js";
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
});
