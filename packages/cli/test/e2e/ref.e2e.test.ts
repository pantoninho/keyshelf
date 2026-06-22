import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeSopsFixture, sopsAvailable, type SopsFixture } from "../conformance/sops-fixture.js";
import { makeTmpDir, removeDir, runKeyshelf } from "./helpers.js";

/**
 * Black-box E2E for key references (`!ref`): a value declared once in a canonical
 * shelf is injected when running a *different* shelf, proving the full slice
 * end to end through the real binary — same-name, rename (`key:`), cross-stage
 * (`stage:`), the one-hop `INVALID_REFERENCE` guard, and a cross-adapter pair
 * (fake ↔ sops) showing the value resolves through the *target's* provider.
 */

const PRINT = (name: string) => ["node", "-e", `process.stdout.write(String(process.env.${name}))`];

/** Write `{shelf}/schema.yaml` + `{shelf}/{stage}.yaml` under the project root. */
async function writeShelf(
  cwd: string,
  shelf: string,
  schema: string,
  envs: Record<string, string>
): Promise<void> {
  const dir = path.join(cwd, ".keyshelf", shelf);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "schema.yaml"), schema, "utf8");
  for (const [stage, contents] of Object.entries(envs)) {
    await writeFile(path.join(dir, `${stage}.yaml`), contents, "utf8");
  }
}

async function writeConfig(cwd: string, providers: Record<string, unknown>): Promise<void> {
  const root = path.join(cwd, ".keyshelf");
  await mkdir(root, { recursive: true });
  await writeFile(
    path.join(root, "config.yaml"),
    stringify({ project: "myapp", providers }),
    "utf8"
  );
}

describe("key references E2E (fake): declare once, consume elsewhere", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await makeTmpDir();
    await writeConfig(cwd, { local: { adapter: "fake" } });
  });

  afterEach(async () => {
    await removeDir(cwd);
  });

  it("injects a value declared once in the shared shelf when running the consuming shelf", async () => {
    // The canonical shelf holds the secret under its own name.
    await writeShelf(cwd, "shared", "keys:\n  DATABASE_PASSWORD: !required\n", {
      staging: "provider: local\nkeys:\n  DATABASE_PASSWORD: !secret\n"
    });
    // The consuming shelf points at it by the same name, no value of its own.
    await writeShelf(cwd, "web", "keys:\n  DATABASE_PASSWORD: !required\n", {
      staging: "provider: local\nkeys:\n  DATABASE_PASSWORD: !ref { shelf: shared }\n"
    });

    const set = await runKeyshelf(["set", "DATABASE_PASSWORD", "shared/staging", "--secret"], {
      cwd,
      input: "declared-once"
    });
    expect(set.code, set.stderr).toBe(0);

    const run = await runKeyshelf(["run", "web/staging", "--", ...PRINT("DATABASE_PASSWORD")], {
      cwd
    });
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toBe("declared-once");
  });

  it("renames via key: a consuming key resolves a differently-named target key", async () => {
    await writeShelf(cwd, "shared", "keys:\n  SHARED_DB:\n", {
      staging: "provider: local\nkeys:\n  SHARED_DB: !secret\n"
    });
    await writeShelf(cwd, "web", "keys:\n  DATABASE_PASSWORD: !required\n", {
      staging:
        "provider: local\nkeys:\n  DATABASE_PASSWORD: !ref { shelf: shared, key: SHARED_DB }\n"
    });

    const set = await runKeyshelf(["set", "SHARED_DB", "shared/staging", "--secret"], {
      cwd,
      input: "renamed-secret"
    });
    expect(set.code, set.stderr).toBe(0);

    const run = await runKeyshelf(["run", "web/staging", "--", ...PRINT("DATABASE_PASSWORD")], {
      cwd
    });
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toBe("renamed-secret");
  });

  it("crosses stages via stage: resolving the target at a different stage", async () => {
    await writeShelf(cwd, "shared", "keys:\n  AUDIT_KEY: !required\n", {
      production: "provider: local\nkeys:\n  AUDIT_KEY: !secret\n"
    });
    await writeShelf(cwd, "web", "keys:\n  AUDIT_KEY: !required\n", {
      staging: "provider: local\nkeys:\n  AUDIT_KEY: !ref { shelf: shared, stage: production }\n"
    });

    const set = await runKeyshelf(["set", "AUDIT_KEY", "shared/production", "--secret"], {
      cwd,
      input: "prod-audit"
    });
    expect(set.code, set.stderr).toBe(0);

    const run = await runKeyshelf(["run", "web/staging", "--", ...PRINT("AUDIT_KEY")], { cwd });
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toBe("prod-audit");
  });

  it("fails INVALID_REFERENCE at run when the target is itself a !ref (one hop only)", async () => {
    // shared -> other is a !ref, so web -> shared lands on a !ref: forbidden.
    await writeShelf(cwd, "other", "keys:\n  DATABASE_PASSWORD: !required\n", {
      staging: "provider: local\nkeys:\n  DATABASE_PASSWORD: !secret\n"
    });
    await writeShelf(cwd, "shared", "keys:\n  DATABASE_PASSWORD: !required\n", {
      staging: "provider: local\nkeys:\n  DATABASE_PASSWORD: !ref { shelf: other }\n"
    });
    await writeShelf(cwd, "web", "keys:\n  DATABASE_PASSWORD: !required\n", {
      staging: "provider: local\nkeys:\n  DATABASE_PASSWORD: !ref { shelf: shared }\n"
    });

    const run = await runKeyshelf(
      ["run", "web/staging", "--json", "--", ...PRINT("DATABASE_PASSWORD")],
      { cwd }
    );
    expect(run.code).not.toBe(0);
    expect(JSON.parse(run.stdout).error.code).toBe("INVALID_REFERENCE");
    // Fail-fast: the wrapped command never ran.
    expect(run.stdout).not.toContain("declared");
  });

  it("fails REFERENCE_NOT_FOUND at run when the target shelf does not exist", async () => {
    await writeShelf(cwd, "web", "keys:\n  DATABASE_PASSWORD: !required\n", {
      staging: "provider: local\nkeys:\n  DATABASE_PASSWORD: !ref { shelf: ghost }\n"
    });

    const run = await runKeyshelf(
      ["run", "web/staging", "--json", "--", ...PRINT("DATABASE_PASSWORD")],
      { cwd }
    );
    expect(run.code).not.toBe(0);
    expect(JSON.parse(run.stdout).error.code).toBe("REFERENCE_NOT_FOUND");
  });

  it("validates and runs a !ref-only mapping environment with no provider", async () => {
    // The consuming environment is a pure mapping: only a key reference, no local
    // secret, no provider. It resolves through the target shelf's provider.
    await writeShelf(cwd, "shared", "keys:\n  DATABASE_PASSWORD: !required\n", {
      staging: "provider: local\nkeys:\n  DATABASE_PASSWORD: !secret\n"
    });
    await writeShelf(cwd, "web", "keys:\n  DATABASE_PASSWORD: !required\n", {
      staging: "keys:\n  DATABASE_PASSWORD: !ref { shelf: shared }\n"
    });

    const set = await runKeyshelf(["set", "DATABASE_PASSWORD", "shared/staging", "--secret"], {
      cwd,
      input: "mapped-no-provider"
    });
    expect(set.code, set.stderr).toBe(0);

    const validate = await runKeyshelf(["validate", "web/staging", "--json"], { cwd });
    expect(validate.code, validate.stderr).toBe(0);

    const run = await runKeyshelf(["run", "web/staging", "--", ...PRINT("DATABASE_PASSWORD")], {
      cwd
    });
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toBe("mapped-no-provider");
  });

  it("validates and runs a config-only environment with no provider", async () => {
    // No local secret and no !ref — just plaintext config, so no provider needed.
    await writeShelf(cwd, "web", "keys:\n  REGION: !required\n", {
      staging: "keys:\n  REGION: eu-west-1\n"
    });

    const validate = await runKeyshelf(["validate", "web/staging", "--json"], { cwd });
    expect(validate.code, validate.stderr).toBe(0);

    const run = await runKeyshelf(["run", "web/staging", "--", ...PRINT("REGION")], { cwd });
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toBe("eu-west-1");
  });

  it("fails PROVIDER_NOT_FOUND when a local !secret is declared with no provider", async () => {
    // A local secret has nowhere to resolve from without a provider.
    await writeShelf(cwd, "web", "keys:\n  DATABASE_PASSWORD: !required\n", {
      staging: "keys:\n  DATABASE_PASSWORD: !secret\n"
    });

    const validate = await runKeyshelf(["validate", "web/staging", "--json"], { cwd });
    expect(validate.code).not.toBe(0);
    expect(JSON.parse(validate.stdout).error.code).toBe("PROVIDER_NOT_FOUND");
  });
});

/**
 * The cross-adapter proof: the canonical value lives in a *sops* shelf, and a
 * *fake* shelf references it. Resolving the consuming (fake) environment must
 * decrypt the value through the target (sops) provider — exactly the case a
 * single shared backend cannot express. Gated on a resolvable sops/age, like the
 * other sops E2E lanes.
 */
if (sopsAvailable()) {
  describe("key references E2E (cross-adapter fake <-> sops)", () => {
    let fixture: SopsFixture;
    let cwd: string;
    const env = () => ({ SOPS_AGE_KEY_FILE: fixture.ageKeyFile });

    beforeEach(async () => {
      // makeSopsFixture also writes a .sops.yaml at its dir root, which is our
      // project root, so the sops shelf's store encrypts under the fixture key.
      fixture = await makeSopsFixture();
      cwd = fixture.dir;
      await writeConfig(cwd, { vault: { adapter: "sops" }, plain: { adapter: "fake" } });
    });

    afterEach(async () => {
      await fixture.teardown();
    });

    it("a fake shelf resolves a value that lives in a sops shelf, through the sops provider", async () => {
      // Canonical value: a sops-encrypted secret in the 'vault' shelf.
      await writeShelf(cwd, "vault", "keys:\n  DATABASE_PASSWORD: !required\n", {
        staging: "provider: vault\nkeys:\n  DATABASE_PASSWORD: !secret\n"
      });
      // Consumer: a fake-provider shelf that only references the sops value.
      await writeShelf(cwd, "web", "keys:\n  DATABASE_PASSWORD: !required\n", {
        staging: "provider: plain\nkeys:\n  DATABASE_PASSWORD: !ref { shelf: vault }\n"
      });

      const set = await runKeyshelf(["set", "DATABASE_PASSWORD", "vault/staging", "--secret"], {
        cwd,
        input: "in-the-vault",
        env: env()
      });
      expect(set.code, set.stderr).toBe(0);

      const run = await runKeyshelf(["run", "web/staging", "--", ...PRINT("DATABASE_PASSWORD")], {
        cwd,
        env: env()
      });
      expect(run.code, run.stderr).toBe(0);
      expect(run.stdout).toBe("in-the-vault");
    });

    it("a sops shelf resolves a value that lives in a fake shelf, through the fake provider", async () => {
      await writeShelf(cwd, "plainshelf", "keys:\n  API_TOKEN: !required\n", {
        staging: "provider: plain\nkeys:\n  API_TOKEN: !secret\n"
      });
      await writeShelf(cwd, "svc", "keys:\n  API_TOKEN: !required\n", {
        staging: "provider: vault\nkeys:\n  API_TOKEN: !ref { shelf: plainshelf }\n"
      });

      const set = await runKeyshelf(["set", "API_TOKEN", "plainshelf/staging", "--secret"], {
        cwd,
        input: "from-fake-store",
        env: env()
      });
      expect(set.code, set.stderr).toBe(0);

      const run = await runKeyshelf(["run", "svc/staging", "--", ...PRINT("API_TOKEN")], {
        cwd,
        env: env()
      });
      expect(run.code, run.stderr).toBe(0);
      expect(run.stdout).toBe("from-fake-store");
    });
  });
} else {
  describe("key references E2E (cross-adapter fake <-> sops)", () => {
    it.skip("skipped: no sops/age binary resolvable on this host", () => {});
  });
}
