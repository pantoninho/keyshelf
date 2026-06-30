import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTmpDir, removeDir, runKeyshelf } from "./helpers.js";

/**
 * Black-box E2E for STATIC, offline key-reference validation (issue #203). Every
 * scenario here drives the real `keyshelf validate` binary and asserts the `!ref`
 * structural checks fire **with no backend access**: the fake store is left
 * empty, so any check that reached a provider to resolve a value would fail with a
 * backend code (e.g. SECRET_NOT_FOUND) instead of the structural REFERENCE_NOT_FOUND
 * / INVALID_REFERENCE we assert. A dangling or chained reference must fail
 * `validate` before any `run`.
 */

let cwd: string;

beforeEach(async () => {
  cwd = await makeTmpDir();
  await write(".keyshelf/config.yaml", "project: myapp\nproviders:\n  local:\n    adapter: fake\n");
});

afterEach(async () => {
  await removeDir(cwd);
});

async function write(rel: string, contents: string): Promise<void> {
  const full = path.join(cwd, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, contents, "utf8");
}

/** Write `{shelf}/schema.yaml` and one or more `{shelf}/environments/{stage}.yaml`. */
async function shelf(name: string, schema: string, envs: Record<string, string>): Promise<void> {
  await write(`.keyshelf/${name}/schema.yaml`, schema);
  for (const [stage, contents] of Object.entries(envs)) {
    await write(`.keyshelf/${name}/environments/${stage}.yaml`, contents);
  }
}

async function seedFakeStore(entries: Record<string, string>): Promise<void> {
  await write(".keyshelf/.fake-store.json", JSON.stringify(entries, null, 2));
}

function errorOf(stdout: string): { code: string } & Record<string, unknown> {
  return JSON.parse(stdout).error;
}

describe("keyshelf validate: static key references (no backend)", () => {
  it("validates a sound reference offline, with the target secret NEVER fetched", async () => {
    // The target declares a !secret, but the store is EMPTY. A check that resolved
    // it would fail SECRET_NOT_FOUND; static validation only confirms it's a secret.
    await shelf("shared", "keys:\n  DATABASE_PASSWORD: !required\n", {
      staging: "provider: local\nkeys:\n  DATABASE_PASSWORD: !secret\n"
    });
    await shelf("web", "keys:\n  DATABASE_PASSWORD: !required\n", {
      staging: "provider: local\nkeys:\n  DATABASE_PASSWORD: !ref { shelf: shared }\n"
    });
    await seedFakeStore({});

    const { code, stdout } = await runKeyshelf(["validate", "web/staging", "--json"], { cwd });
    expect(code, stdout).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ environment: "web/staging", valid: true });
  });

  it("validates a !ref onto a plaintext config target, fully offline", async () => {
    // The target value is plaintext config in the shared shelf; resolving it
    // touches no backend at all, and the static checks confirm it lands one hop.
    await shelf("shared", "keys:\n  REGION: eu-west-1\n", {
      staging: "provider: local\nkeys:\n  REGION: eu-west-1\n"
    });
    await shelf("web", "keys:\n  REGION: !required\n", {
      staging: "provider: local\nkeys:\n  REGION: !ref { shelf: shared }\n"
    });

    const { code, stdout } = await runKeyshelf(["validate", "web/staging", "--json"], { cwd });
    expect(code, stdout).toBe(0);
    expect(JSON.parse(stdout).valid).toBe(true);
  });

  it("validates a !ref-only mapping environment that omits its own provider", async () => {
    // The consuming environment is all !ref — no local secret, so it may omit
    // provider: entirely (ADR-0007 / #208). The target secret is never fetched
    // (store left empty), so this stays fully offline at validate time.
    await shelf("shared", "keys:\n  DATABASE_PASSWORD: !required\n", {
      staging: "provider: local\nkeys:\n  DATABASE_PASSWORD: !secret\n"
    });
    await shelf("web", "keys:\n  DATABASE_PASSWORD: !required\n", {
      staging: "keys:\n  DATABASE_PASSWORD: !ref { shelf: shared }\n"
    });
    await seedFakeStore({});

    const { code, stdout } = await runKeyshelf(["validate", "web/staging", "--json"], { cwd });
    expect(code, stdout).toBe(0);
    expect(JSON.parse(stdout).valid).toBe(true);
  });

  it("REFERENCE_NOT_FOUND when the target shelf does not exist", async () => {
    await shelf("web", "keys:\n  DATABASE_PASSWORD: !required\n", {
      staging: "provider: local\nkeys:\n  DATABASE_PASSWORD: !ref { shelf: ghost }\n"
    });
    const { code, stdout } = await runKeyshelf(["validate", "web/staging", "--json"], { cwd });
    expect(code).not.toBe(0);
    expect(errorOf(stdout).code).toBe("REFERENCE_NOT_FOUND");
  });

  it("REFERENCE_NOT_FOUND when the target stage does not exist", async () => {
    await shelf("shared", "keys:\n  DATABASE_PASSWORD: !required\n", {
      staging: "provider: local\nkeys:\n  DATABASE_PASSWORD: !secret\n"
    });
    await shelf("web", "keys:\n  DATABASE_PASSWORD: !required\n", {
      staging: "provider: local\nkeys:\n  DATABASE_PASSWORD: !ref { shelf: shared, stage: prod }\n"
    });
    const { code, stdout } = await runKeyshelf(["validate", "web/staging", "--json"], { cwd });
    expect(code).not.toBe(0);
    expect(errorOf(stdout).code).toBe("REFERENCE_NOT_FOUND");
  });

  it("REFERENCE_NOT_FOUND when the target key is not declared in the target schema", async () => {
    await shelf("shared", "keys:\n  OTHER: !required\n", {
      staging: "provider: local\nkeys:\n  OTHER: !secret\n"
    });
    await shelf("web", "keys:\n  DATABASE_PASSWORD: !required\n", {
      staging: "provider: local\nkeys:\n  DATABASE_PASSWORD: !ref { shelf: shared }\n"
    });
    const { code, stdout } = await runKeyshelf(["validate", "web/staging", "--json"], { cwd });
    expect(code).not.toBe(0);
    expect(errorOf(stdout).code).toBe("REFERENCE_NOT_FOUND");
  });

  it("REFERENCE_NOT_FOUND when the target key is declared but supplies no value", async () => {
    // DATABASE_PASSWORD is !required in the target schema but absent from its env
    // and has no default — present-in-schema, unsupplied-in-env.
    await shelf("shared", "keys:\n  DATABASE_PASSWORD: !required\n  REGION: eu\n", {
      staging: "provider: local\nkeys:\n  REGION: eu\n"
    });
    await shelf("web", "keys:\n  DATABASE_PASSWORD: !required\n", {
      staging: "provider: local\nkeys:\n  DATABASE_PASSWORD: !ref { shelf: shared }\n"
    });
    const { code, stdout } = await runKeyshelf(["validate", "web/staging", "--json"], { cwd });
    expect(code).not.toBe(0);
    expect(errorOf(stdout).code).toBe("REFERENCE_NOT_FOUND");
  });

  it("INVALID_REFERENCE when the target is itself a !ref (one hop only)", async () => {
    await shelf("other", "keys:\n  DATABASE_PASSWORD: !required\n", {
      staging: "provider: local\nkeys:\n  DATABASE_PASSWORD: !secret\n"
    });
    await shelf("shared", "keys:\n  DATABASE_PASSWORD: !required\n", {
      staging: "provider: local\nkeys:\n  DATABASE_PASSWORD: !ref { shelf: other }\n"
    });
    await shelf("web", "keys:\n  DATABASE_PASSWORD: !required\n", {
      staging: "provider: local\nkeys:\n  DATABASE_PASSWORD: !ref { shelf: shared }\n"
    });
    const { code, stdout } = await runKeyshelf(["validate", "web/staging", "--json"], { cwd });
    expect(code).not.toBe(0);
    expect(errorOf(stdout).code).toBe("INVALID_REFERENCE");
  });

  it("INVALID_REFERENCE for a malformed scalar !ref (no shelf payload)", async () => {
    await shelf("web", "keys:\n  DATABASE_PASSWORD: !required\n", {
      staging: "provider: local\nkeys:\n  DATABASE_PASSWORD: !ref hmm\n"
    });
    const { code, stdout } = await runKeyshelf(["validate", "web/staging", "--json"], { cwd });
    expect(code).not.toBe(0);
    // A scalar !ref is rejected at load as malformed; both codes are acceptable
    // structural rejections of a bad reference payload.
    expect(["INVALID_REFERENCE", "MALFORMED_FILE"]).toContain(errorOf(stdout).code);
  });

  it("a !ref satisfies a !required key in the consuming schema (check 1)", async () => {
    // The consuming schema marks DATABASE_PASSWORD !required; supplying only a
    // !ref (no config/secret value) must NOT raise MISSING_REQUIRED.
    await shelf("shared", "keys:\n  DATABASE_PASSWORD: !required\n", {
      staging: "provider: local\nkeys:\n  DATABASE_PASSWORD: !secret\n"
    });
    await shelf("web", "keys:\n  REGION: eu\n  DATABASE_PASSWORD: !required\n", {
      staging: "provider: local\nkeys:\n  REGION: eu\n  DATABASE_PASSWORD: !ref { shelf: shared }\n"
    });
    await seedFakeStore({});
    const { code, stdout } = await runKeyshelf(["validate", "web/staging", "--json"], { cwd });
    expect(code, stdout).toBe(0);
    expect(JSON.parse(stdout).valid).toBe(true);
  });

  it("surfaces the reference failure per-environment in whole-project --json", async () => {
    await shelf("web", "keys:\n  DATABASE_PASSWORD: !required\n", {
      staging: "provider: local\nkeys:\n  DATABASE_PASSWORD: !ref { shelf: ghost }\n"
    });
    const { code, stdout } = await runKeyshelf(["validate", "--json"], { cwd });
    expect(code).not.toBe(0);
    const byEnv = Object.fromEntries(
      JSON.parse(stdout).results.map((r: { environment: string }) => [r.environment, r])
    );
    expect(byEnv["web/staging"]).toMatchObject({
      valid: false,
      error: { code: "REFERENCE_NOT_FOUND" }
    });
  });
});
