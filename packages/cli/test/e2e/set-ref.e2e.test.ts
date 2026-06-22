import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTmpDir, removeDir, runKeyshelf } from "./helpers.js";

/**
 * Black-box E2E for authoring key references via `keyshelf set --ref` (ADR-0007,
 * issue #204). Asserts the exact `!ref` node written for same-name, cross-stage,
 * and rename authoring; that it is a pure offline file edit (no value read, no
 * provider credentials, no backend write); and that an authored node round-trips
 * — `set --ref` then `run` resolves the value through the target's provider.
 */

const PRINT = (name: string) => ["node", "-e", `process.stdout.write(String(process.env.${name}))`];

async function write(cwd: string, rel: string, contents: string): Promise<void> {
  const full = path.join(cwd, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, contents, "utf8");
}

async function read(cwd: string, rel: string): Promise<string> {
  return readFile(path.join(cwd, rel), "utf8");
}

/** Read the parsed `!ref` payload of `key` from a consuming environment file. */
async function refNode(cwd: string, rel: string, key: string): Promise<unknown> {
  const doc = parseDocument(await read(cwd, rel));
  const keys = doc.get("keys", true) as { get(k: string, keep: boolean): { toJSON(): unknown } };
  return keys.get(key, true).toJSON();
}

describe("keyshelf set <KEY> <shelf>/<stage> --ref", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await makeTmpDir();
    // A canonical shelf (holds real secrets) and a mapping shelf with no provider
    // of its own — only config + !ref need no provider (ADR-0007).
    await write(
      cwd,
      ".keyshelf/config.yaml",
      "project: myapp\nproviders:\n  local:\n    adapter: fake\n"
    );
    await write(
      cwd,
      ".keyshelf/shared/schema.yaml",
      "keys:\n  SUPABASE_SERVICE_ROLE_KEY: !required\n  SERVICE_ROLE_KEY: !required\n  AUDIT_KEY: !required\n"
    );
    await write(
      cwd,
      ".keyshelf/web/schema.yaml",
      "keys:\n  SUPABASE_SERVICE_ROLE_KEY: !required\n  DB_PASSWORD: !required\n  AUDIT_KEY: !required\n  UNKNOWN_TO_SCHEMA: !optional\n"
    );
  });

  afterEach(async () => {
    await removeDir(cwd);
  });

  it("writes !ref { shelf } for a same-name, current-stage reference", async () => {
    await write(
      cwd,
      ".keyshelf/web/production.yaml",
      "provider: local\nkeys:\n  AUDIT_KEY: keep\n"
    );
    const { code, stdout } = await runKeyshelf(
      ["set", "SUPABASE_SERVICE_ROLE_KEY", "web/production", "--ref", "supabase", "--json"],
      { cwd }
    );
    expect(code, stdout).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      key: "SUPABASE_SERVICE_ROLE_KEY",
      environment: "web/production",
      ref: true
    });

    expect(
      await refNode(cwd, ".keyshelf/web/production.yaml", "SUPABASE_SERVICE_ROLE_KEY")
    ).toEqual({
      shelf: "supabase"
    });
    // In-place edit: the provider line and other keys survive, value is a !ref.
    const text = await read(cwd, ".keyshelf/web/production.yaml");
    expect(text).toContain("provider: local");
    expect(text).toContain("AUDIT_KEY: keep");
    expect(text).toContain("!ref");
  });

  it("writes an explicit stage: for --ref <shelf>/<stage>", async () => {
    await write(cwd, ".keyshelf/web/staging.yaml", "provider: local\nkeys:\n  DB_PASSWORD: x\n");
    const { code } = await runKeyshelf(
      ["set", "AUDIT_KEY", "web/staging", "--ref", "shared/production"],
      { cwd }
    );
    expect(code).toBe(0);
    expect(await refNode(cwd, ".keyshelf/web/staging.yaml", "AUDIT_KEY")).toEqual({
      shelf: "shared",
      stage: "production"
    });
  });

  it("writes a key: for a rename with --ref-key", async () => {
    await write(cwd, ".keyshelf/web/staging.yaml", "provider: local\nkeys:\n  AUDIT_KEY: x\n");
    const { code } = await runKeyshelf(
      ["set", "DB_PASSWORD", "web/staging", "--ref", "supabase", "--ref-key", "SERVICE_ROLE_KEY"],
      { cwd }
    );
    expect(code).toBe(0);
    expect(await refNode(cwd, ".keyshelf/web/staging.yaml", "DB_PASSWORD")).toEqual({
      shelf: "supabase",
      key: "SERVICE_ROLE_KEY"
    });
  });

  it("omits key: when --ref-key equals the consuming key (same-name)", async () => {
    await write(cwd, ".keyshelf/web/staging.yaml", "provider: local\nkeys:\n  AUDIT_KEY: x\n");
    const { code } = await runKeyshelf(
      [
        "set",
        "SUPABASE_SERVICE_ROLE_KEY",
        "web/staging",
        "--ref",
        "supabase",
        "--ref-key",
        "SUPABASE_SERVICE_ROLE_KEY"
      ],
      { cwd }
    );
    expect(code).toBe(0);
    expect(await refNode(cwd, ".keyshelf/web/staging.yaml", "SUPABASE_SERVICE_ROLE_KEY")).toEqual({
      shelf: "supabase"
    });
  });

  it("is a pure offline edit: no stdin read, no backend write, no credentials", async () => {
    // The consuming env names a provider whose adapter is unregistered. set --secret
    // would create that adapter and fail ADAPTER_UNAVAILABLE; set --ref must not —
    // it authors a pointer, never touching the provider or reading stdin.
    await write(
      cwd,
      ".keyshelf/config.yaml",
      "project: myapp\nproviders:\n  local:\n    adapter: fake\n  bogus:\n    adapter: no-such-adapter\n"
    );
    await write(cwd, ".keyshelf/web/staging.yaml", "provider: bogus\nkeys:\n  DB_PASSWORD: x\n");
    const { code, stdout } = await runKeyshelf(
      ["set", "AUDIT_KEY", "web/staging", "--ref", "shared", "--json"],
      { cwd } // note: no `input` — set --ref reads nothing from stdin
    );
    expect(code, stdout).toBe(0);
    expect(await refNode(cwd, ".keyshelf/web/staging.yaml", "AUDIT_KEY")).toEqual({
      shelf: "shared"
    });
    // No fake store file is created — nothing was written to any backend.
    const text = await read(cwd, ".keyshelf/web/staging.yaml");
    expect(text).toContain("provider: bogus");
  });

  it("rejects a key not in the consuming shelf's schema with UNKNOWN_KEY", async () => {
    await write(cwd, ".keyshelf/web/staging.yaml", "provider: local\nkeys:\n  DB_PASSWORD: x\n");
    const { code, stdout } = await runKeyshelf(
      ["set", "NOPE", "web/staging", "--ref", "shared", "--json"],
      { cwd }
    );
    expect(code).not.toBe(0);
    expect(JSON.parse(stdout).error.code).toBe("UNKNOWN_KEY");
  });

  it("rejects --ref together with --secret", async () => {
    await write(cwd, ".keyshelf/web/staging.yaml", "provider: local\nkeys:\n  DB_PASSWORD: x\n");
    const { code } = await runKeyshelf(
      ["set", "AUDIT_KEY", "web/staging", "--ref", "shared", "--secret"],
      { cwd, input: "x" }
    );
    expect(code).not.toBe(0);
  });

  it("rejects --ref-key without --ref", async () => {
    await write(cwd, ".keyshelf/web/staging.yaml", "provider: local\nkeys:\n  DB_PASSWORD: x\n");
    const { code } = await runKeyshelf(["set", "AUDIT_KEY", "web/staging", "--ref-key", "OTHER"], {
      cwd,
      input: "x"
    });
    expect(code).not.toBe(0);
  });
});

describe("set --ref round-trips: authored reference resolves at run", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await makeTmpDir();
    await write(
      cwd,
      ".keyshelf/config.yaml",
      "project: myapp\nproviders:\n  local:\n    adapter: fake\n"
    );
  });

  afterEach(async () => {
    await removeDir(cwd);
  });

  it("same-name: set --ref then run resolves the canonical value", async () => {
    await write(cwd, ".keyshelf/shared/schema.yaml", "keys:\n  DATABASE_PASSWORD: !required\n");
    await write(
      cwd,
      ".keyshelf/shared/staging.yaml",
      "provider: local\nkeys:\n  DATABASE_PASSWORD: !secret\n"
    );
    await write(cwd, ".keyshelf/web/schema.yaml", "keys:\n  DATABASE_PASSWORD: !required\n");
    await write(
      cwd,
      ".keyshelf/web/staging.yaml",
      "provider: local\nkeys:\n  DATABASE_PASSWORD: placeholder\n"
    );

    const store = await runKeyshelf(["set", "DATABASE_PASSWORD", "shared/staging", "--secret"], {
      cwd,
      input: "declared-once"
    });
    expect(store.code, store.stderr).toBe(0);

    const author = await runKeyshelf(
      ["set", "DATABASE_PASSWORD", "web/staging", "--ref", "shared"],
      { cwd }
    );
    expect(author.code, author.stderr).toBe(0);

    const run = await runKeyshelf(["run", "web/staging", "--", ...PRINT("DATABASE_PASSWORD")], {
      cwd
    });
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toBe("declared-once");
  });

  it("rename: set --ref --ref-key then run resolves the differently-named target", async () => {
    await write(cwd, ".keyshelf/shared/schema.yaml", "keys:\n  SERVICE_ROLE_KEY: !required\n");
    await write(
      cwd,
      ".keyshelf/shared/staging.yaml",
      "provider: local\nkeys:\n  SERVICE_ROLE_KEY: !secret\n"
    );
    await write(cwd, ".keyshelf/web/schema.yaml", "keys:\n  DB_PASSWORD: !required\n");
    await write(
      cwd,
      ".keyshelf/web/staging.yaml",
      "provider: local\nkeys:\n  DB_PASSWORD: placeholder\n"
    );

    const store = await runKeyshelf(["set", "SERVICE_ROLE_KEY", "shared/staging", "--secret"], {
      cwd,
      input: "renamed-secret"
    });
    expect(store.code, store.stderr).toBe(0);

    const author = await runKeyshelf(
      ["set", "DB_PASSWORD", "web/staging", "--ref", "shared", "--ref-key", "SERVICE_ROLE_KEY"],
      { cwd }
    );
    expect(author.code, author.stderr).toBe(0);

    const run = await runKeyshelf(["run", "web/staging", "--", ...PRINT("DB_PASSWORD")], { cwd });
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toBe("renamed-secret");
  });

  it("cross-stage: set --ref <shelf>/<stage> then run resolves at the target stage", async () => {
    await write(cwd, ".keyshelf/shared/schema.yaml", "keys:\n  AUDIT_KEY: !required\n");
    await write(
      cwd,
      ".keyshelf/shared/production.yaml",
      "provider: local\nkeys:\n  AUDIT_KEY: !secret\n"
    );
    await write(cwd, ".keyshelf/web/schema.yaml", "keys:\n  AUDIT_KEY: !required\n");
    await write(
      cwd,
      ".keyshelf/web/staging.yaml",
      "provider: local\nkeys:\n  AUDIT_KEY: placeholder\n"
    );

    const store = await runKeyshelf(["set", "AUDIT_KEY", "shared/production", "--secret"], {
      cwd,
      input: "prod-audit"
    });
    expect(store.code, store.stderr).toBe(0);

    const author = await runKeyshelf(
      ["set", "AUDIT_KEY", "web/staging", "--ref", "shared/production"],
      { cwd }
    );
    expect(author.code, author.stderr).toBe(0);

    const run = await runKeyshelf(["run", "web/staging", "--", ...PRINT("AUDIT_KEY")], { cwd });
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toBe("prod-audit");
  });
});
