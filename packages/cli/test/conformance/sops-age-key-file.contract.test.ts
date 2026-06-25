import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAdapter } from "../../src/adapters/registry.js";
import { KeyshelfError } from "../../src/errors.js";
import { makeSopsFixture, sopsAvailable, type SopsFixture } from "./sops-fixture.js";

// The `ageKeyFile` provider field (ADR-0010): keyshelf locates the sops age
// identity per-environment, then delegates the mechanism by handing it to sops as
// `SOPS_AGE_KEY_FILE`. These tests prove the field actually drives decryption —
// with no ambient `SOPS_AGE_KEY_FILE` in the environment — and that the path is
// resolved relative to the project root, exactly like `store`.
//
// Skips when no sops/age binary is resolvable, mirroring the contract suite.
const d = sopsAvailable() ? describe : describe.skip;

d("sops ageKeyFile provider field", () => {
  let fixture: SopsFixture;
  let savedEnv: string | undefined;

  beforeEach(async () => {
    fixture = await makeSopsFixture();
    // The whole point of the field is to work *without* the ambient env var, so
    // strip it for the duration and restore it after.
    savedEnv = process.env.SOPS_AGE_KEY_FILE;
    delete process.env.SOPS_AGE_KEY_FILE;
  });

  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.SOPS_AGE_KEY_FILE;
    else process.env.SOPS_AGE_KEY_FILE = savedEnv;
    await fixture.teardown();
  });

  it("round-trips with ageKeyFile resolved relative to the project root, no ambient key", async () => {
    const ctx = { projectDir: fixture.dir, project: "myapp", shelf: "app", stage: "staging" };
    // The fixture key lives under the project dir; reference it *relatively* so a
    // successful resolve also proves the registry resolved it against projectDir.
    const relKey = path.relative(fixture.dir, fixture.ageKeyFile);
    const adapter = createAdapter({ adapter: "sops", ageKeyFile: relKey }, ctx);

    await adapter.write("DATABASE_PASSWORD", "sekret");
    expect(await adapter.resolve("DATABASE_PASSWORD")).toBe("sekret");
  });

  it("expands a leading ~/ in ageKeyFile to the user's home directory", async () => {
    const ctx = { projectDir: fixture.dir, project: "myapp", shelf: "app", stage: "staging" };
    // Point HOME at the fixture dir so `~/age-key.txt` resolves to the fixture's
    // key. A successful round-trip proves the tilde was expanded to $HOME, not
    // resolved literally against projectDir (which would be `<dir>/~/age-key.txt`).
    const savedHome = process.env.HOME;
    process.env.HOME = fixture.dir;
    try {
      const tildeKey = `~/${path.relative(fixture.dir, fixture.ageKeyFile)}`;
      const adapter = createAdapter({ adapter: "sops", ageKeyFile: tildeKey }, ctx);

      await adapter.write("DATABASE_PASSWORD", "sekret");
      expect(await adapter.resolve("DATABASE_PASSWORD")).toBe("sekret");
    } finally {
      if (savedHome === undefined) delete process.env.HOME;
      else process.env.HOME = savedHome;
    }
  });

  it("fails PROVIDER_AUTH when no ageKeyFile is configured and no ambient key exists", async () => {
    const ctx = { projectDir: fixture.dir, project: "myapp", shelf: "app", stage: "staging" };
    const adapter = createAdapter({ adapter: "sops" }, ctx);

    // The store's data key can't be recovered without an identity: `write`'s
    // `sops set` must decrypt to re-encrypt, so this is where it surfaces.
    let thrown: unknown;
    try {
      await adapter.write("DATABASE_PASSWORD", "sekret");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(KeyshelfError);
    expect((thrown as KeyshelfError).code).toBe("PROVIDER_AUTH");
  });
});
