import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTmpDir, removeDir, runKeyshelf } from "./helpers.js";

let cwd: string;

beforeEach(async () => {
  cwd = await makeTmpDir();
});

afterEach(async () => {
  await removeDir(cwd);
});

async function write(rel: string, contents: string): Promise<void> {
  const full = path.join(cwd, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, contents, "utf8");
}

const CONFIG = `project: myapp
providers:
  local:
    adapter: sops
  store:
    adapter: fake
`;

const SCHEMA = `keys:
  LOG_LEVEL: info
  REGION: !required
  FEATURE_X: !optional
  DATABASE_PASSWORD: !required
`;

const GOOD_ENV = `provider: store
keys:
  REGION: eu-west-1
  DATABASE_PASSWORD: !secret
`;

async function scaffold(): Promise<void> {
  await write(".keyshelf/config.yaml", CONFIG);
  await write(".keyshelf/web/schema.yaml", SCHEMA);
  await write(".keyshelf/web/staging.yaml", GOOD_ENV);
  // "valid means would run": the declared secret must be resolvable.
  await seedFakeStore({
    keyshelf__myapp__web__staging__DATABASE_PASSWORD: "pw",
    keyshelf__myapp__web__prod__DATABASE_PASSWORD: "pw",
    keyshelf__myapp__api__dev__TOKEN: "tok"
  });
}

/** Seed the file-backed fake store the `fake` adapter reads (storedName -> value). */
async function seedFakeStore(entries: Record<string, string>): Promise<void> {
  await write(".keyshelf/.fake-store.json", JSON.stringify(entries, null, 2));
}

function errorOf(stdout: string): { code: string } & Record<string, unknown> {
  return JSON.parse(stdout).error;
}

describe("keyshelf validate <shelf>/<env>", () => {
  it("validates a well-formed environment successfully", async () => {
    await scaffold();
    const { code, stdout } = await runKeyshelf(["validate", "web/staging", "--json"], { cwd });
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(result).toMatchObject({ environment: "web/staging", valid: true });
  });

  it("reports UNKNOWN_KEY for an undeclared key", async () => {
    await scaffold();
    await write(".keyshelf/web/staging.yaml", `${GOOD_ENV}  EXTRA: nope\n`);
    const { code, stdout } = await runKeyshelf(["validate", "web/staging", "--json"], { cwd });
    expect(code).not.toBe(0);
    expect(errorOf(stdout)).toMatchObject({ code: "UNKNOWN_KEY", key: "EXTRA" });
  });

  it("reports MISSING_REQUIRED for an absent required key", async () => {
    await scaffold();
    await write(".keyshelf/web/staging.yaml", "provider: local\nkeys:\n  REGION: eu\n");
    const { code, stdout } = await runKeyshelf(["validate", "web/staging", "--json"], { cwd });
    expect(code).not.toBe(0);
    expect(errorOf(stdout)).toMatchObject({ code: "MISSING_REQUIRED", key: "DATABASE_PASSWORD" });
  });

  it("reports INVALID_KEY_NAME for a non-identifier key", async () => {
    await scaffold();
    await write(".keyshelf/web/staging.yaml", `${GOOD_ENV}  "bad-key": x\n`);
    const { code, stdout } = await runKeyshelf(["validate", "web/staging", "--json"], { cwd });
    expect(code).not.toBe(0);
    expect(errorOf(stdout)).toMatchObject({ code: "INVALID_KEY_NAME", key: "bad-key" });
  });

  it("reports PROVIDER_NOT_FOUND for an undefined provider", async () => {
    await scaffold();
    await write(
      ".keyshelf/web/staging.yaml",
      GOOD_ENV.replace("provider: store", "provider: ghost")
    );
    const { code, stdout } = await runKeyshelf(["validate", "web/staging", "--json"], { cwd });
    expect(code).not.toBe(0);
    expect(errorOf(stdout)).toMatchObject({ code: "PROVIDER_NOT_FOUND", provider: "ghost" });
  });

  it("reports SHELF_NOT_FOUND for an unknown shelf", async () => {
    await scaffold();
    const { code, stdout } = await runKeyshelf(["validate", "ghost/staging", "--json"], { cwd });
    expect(code).not.toBe(0);
    expect(errorOf(stdout)).toMatchObject({ code: "SHELF_NOT_FOUND", shelf: "ghost" });
  });

  it("reports SCHEMA_NOT_FOUND for a shelf without a schema", async () => {
    await scaffold();
    await write(".keyshelf/noschema/dev.yaml", "provider: local\nkeys: {}\n");
    const { code, stdout } = await runKeyshelf(["validate", "noschema/dev", "--json"], { cwd });
    expect(code).not.toBe(0);
    expect(errorOf(stdout)).toMatchObject({ code: "SCHEMA_NOT_FOUND", shelf: "noschema" });
  });

  it("reports ENVIRONMENT_NOT_FOUND for an unknown environment", async () => {
    await scaffold();
    const { code, stdout } = await runKeyshelf(["validate", "web/prod", "--json"], { cwd });
    expect(code).not.toBe(0);
    expect(errorOf(stdout)).toMatchObject({
      code: "ENVIRONMENT_NOT_FOUND",
      environment: "web/prod"
    });
  });

  it("reports MALFORMED_FILE with file + reason for an unparseable environment", async () => {
    await scaffold();
    await write(".keyshelf/web/staging.yaml", "provider: local\nkeys: {bad\n");
    const { code, stdout } = await runKeyshelf(["validate", "web/staging", "--json"], { cwd });
    expect(code).not.toBe(0);
    const err = errorOf(stdout);
    expect(err.code).toBe("MALFORMED_FILE");
    expect(String(err.file)).toContain("staging.yaml");
    expect(typeof err.reason).toBe("string");
  });

  it("reports NOT_INITIALIZED when no .keyshelf is present", async () => {
    const { code, stdout } = await runKeyshelf(["validate", "web/staging", "--json"], { cwd });
    expect(code).not.toBe(0);
    expect(errorOf(stdout).code).toBe("NOT_INITIALIZED");
  });

  it("rejects a malformed argument that is not shelf/env", async () => {
    await scaffold();
    const { code } = await runKeyshelf(["validate", "webstaging", "--json"], { cwd });
    expect(code).not.toBe(0);
  });

  it("reports SECRET_NOT_FOUND when a declared secret is unresolvable (valid means would run)", async () => {
    await scaffold();
    // Same env, but the store has no value for the declared secret.
    await seedFakeStore({});
    const { code, stdout } = await runKeyshelf(["validate", "web/staging", "--json"], { cwd });
    expect(code).not.toBe(0);
    expect(errorOf(stdout)).toMatchObject({ code: "SECRET_NOT_FOUND", key: "DATABASE_PASSWORD" });
  });

  it("validates a resolvable explicit { ref } override secret", async () => {
    await scaffold();
    await write(
      ".keyshelf/web/staging.yaml",
      "provider: store\nkeys:\n  REGION: eu\n  DATABASE_PASSWORD: !secret { ref: shared-pw }\n"
    );
    await seedFakeStore({ "shared-pw": "pw" });
    const { code, stdout } = await runKeyshelf(["validate", "web/staging", "--json"], { cwd });
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ environment: "web/staging", valid: true });
  });
});

describe("keyshelf validate (whole project)", () => {
  it("validates every environment and reports an all-valid aggregate", async () => {
    await scaffold();
    await write(".keyshelf/web/prod.yaml", GOOD_ENV);
    await write(".keyshelf/api/schema.yaml", "keys:\n  TOKEN: !required\n");
    await write(".keyshelf/api/dev.yaml", "provider: store\nkeys:\n  TOKEN: !secret\n");

    const { code, stdout } = await runKeyshelf(["validate", "--json"], { cwd });
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.valid).toBe(true);
    const ids = result.results.map((r: { environment: string }) => r.environment).sort();
    expect(ids).toEqual(["api/dev", "web/prod", "web/staging"]);
    expect(result.results.every((r: { valid: boolean }) => r.valid)).toBe(true);
  });

  it("aggregates per-environment failures and exits non-zero", async () => {
    await scaffold();
    await write(".keyshelf/web/prod.yaml", "provider: local\nkeys:\n  REGION: eu\n"); // missing required
    await write(".keyshelf/api/schema.yaml", "keys:\n  TOKEN: !required\n");
    await write(".keyshelf/api/dev.yaml", "provider: ghost\nkeys:\n  TOKEN: !secret\n"); // bad provider

    const { code, stdout } = await runKeyshelf(["validate", "--json"], { cwd });
    expect(code).not.toBe(0);
    const result = JSON.parse(stdout);
    expect(result.valid).toBe(false);

    const byEnv = Object.fromEntries(
      result.results.map((r: { environment: string }) => [r.environment, r])
    );
    expect(byEnv["web/staging"].valid).toBe(true);
    expect(byEnv["web/prod"]).toMatchObject({ valid: false, error: { code: "MISSING_REQUIRED" } });
    expect(byEnv["api/dev"]).toMatchObject({ valid: false, error: { code: "PROVIDER_NOT_FOUND" } });
  });

  it("marks an environment invalid when its declared secret is unresolvable", async () => {
    await scaffold();
    await write(".keyshelf/api/schema.yaml", "keys:\n  TOKEN: !required\n");
    await write(".keyshelf/api/dev.yaml", "provider: store\nkeys:\n  TOKEN: !secret\n");
    // Store seeds web/staging's secret but NOT api/dev's TOKEN.
    await seedFakeStore({ keyshelf__myapp__web__staging__DATABASE_PASSWORD: "pw" });

    const { code, stdout } = await runKeyshelf(["validate", "--json"], { cwd });
    expect(code).not.toBe(0);
    const result = JSON.parse(stdout);
    const byEnv = Object.fromEntries(
      result.results.map((r: { environment: string }) => [r.environment, r])
    );
    expect(byEnv["web/staging"].valid).toBe(true);
    expect(byEnv["api/dev"]).toMatchObject({ valid: false, error: { code: "SECRET_NOT_FOUND" } });
  });

  it("reports NOT_INITIALIZED for whole-project mode without a project", async () => {
    const { code, stdout } = await runKeyshelf(["validate", "--json"], { cwd });
    expect(code).not.toBe(0);
    expect(errorOf(stdout).code).toBe("NOT_INITIALIZED");
  });

  it("exposes --help and exits zero", async () => {
    const { code, stdout } = await runKeyshelf(["validate", "--help"], { cwd });
    expect(code).toBe(0);
    expect(stdout).toContain("validate");
  });
});
