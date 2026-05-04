import { it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import type { Provider, ProviderContext } from "../../../src/providers/types.js";
import { generateIdentity } from "../../../src/providers/age.js";

interface SharedTestOptions<P extends Provider> {
  prefix: string;
  createProvider: () => P;
  buildConfig: (paths: { tmpDir: string; identityFile: string }) => Record<string, string>;
}

interface SharedTestState<P extends Provider> {
  tmpDir: string;
  identityFile: string;
  provider: P;
  ctx: (keyPath: string) => ProviderContext;
}

export function shareCommonProviderTests<P extends Provider>(
  opts: SharedTestOptions<P>
): SharedTestState<P> {
  const state = {} as SharedTestState<P>;

  beforeEach(async () => {
    state.tmpDir = await mkdtemp(join(tmpdir(), opts.prefix));
    state.identityFile = join(state.tmpDir, "key.txt");
    const identity = await generateIdentity();
    await writeFile(state.identityFile, identity);
    state.provider = opts.createProvider();
    const config = opts.buildConfig({ tmpDir: state.tmpDir, identityFile: state.identityFile });
    state.ctx = (keyPath: string) => ({
      keyPath,
      envName: "test",
      rootDir: state.tmpDir,
      config: { ...config }
    });
  });

  it("roundtrips set + resolve", async () => {
    await state.provider.set(state.ctx("db/password"), "supersecret");
    expect(await state.provider.resolve(state.ctx("db/password"))).toBe("supersecret");
  });

  it("roundtrips multiple keys", async () => {
    await state.provider.set(state.ctx("db/password"), "dbpass");
    await state.provider.set(state.ctx("api/key"), "apikey123");
    expect(await state.provider.resolve(state.ctx("db/password"))).toBe("dbpass");
    expect(await state.provider.resolve(state.ctx("api/key"))).toBe("apikey123");
  });

  it("overwrites existing secret", async () => {
    await state.provider.set(state.ctx("db/password"), "old");
    await state.provider.set(state.ctx("db/password"), "new");
    expect(await state.provider.resolve(state.ctx("db/password"))).toBe("new");
  });

  it("validate returns true for existing secret", async () => {
    await state.provider.set(state.ctx("db/password"), "value");
    expect(await state.provider.validate(state.ctx("db/password"))).toBe(true);
  });

  it("validate returns false for missing secret", async () => {
    expect(await state.provider.validate(state.ctx("missing/key"))).toBe(false);
  });

  it("handles empty string values", async () => {
    await state.provider.set(state.ctx("empty"), "");
    expect(await state.provider.resolve(state.ctx("empty"))).toBe("");
  });

  it("handles special characters", async () => {
    const special = 'p@$$w0rd!#%^&*()_+{}|:"<>?`~';
    await state.provider.set(state.ctx("special"), special);
    expect(await state.provider.resolve(state.ctx("special"))).toBe(special);
  });

  it("expands ~ in config paths", async () => {
    const home = homedir();
    if (!state.tmpDir.startsWith(home)) return;
    const baseConfig = opts.buildConfig({ tmpDir: state.tmpDir, identityFile: state.identityFile });
    const tildeConfig: Record<string, string> = {};
    for (const [k, v] of Object.entries(baseConfig)) {
      tildeConfig[k] = v.replace(home, "~");
    }
    const tildeCtx: ProviderContext = {
      keyPath: "tilde/test",
      envName: "test",
      rootDir: state.tmpDir,
      config: tildeConfig
    };
    await state.provider.set(tildeCtx, "tilde-value");
    expect(await state.provider.resolve(tildeCtx)).toBe("tilde-value");
  });

  return state;
}

export function testRequiredConfigKey<P extends Provider>(
  state: SharedTestState<P>,
  missingKey: string,
  remainingConfig: () => Record<string, string>
) {
  it(`throws when ${missingKey} is missing from config`, async () => {
    await expect(
      state.provider.resolve({
        keyPath: "k",
        envName: "test",
        rootDir: state.tmpDir,
        config: remainingConfig()
      })
    ).rejects.toThrow(missingKey);
  });
}
