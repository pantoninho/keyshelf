import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KeyshelfError } from "../../src/errors.js";
import { listEnvironments, loadEnvironment } from "../../src/loader.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "keyshelf-loader-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(rel: string, contents: string): Promise<void> {
  const full = path.join(root, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, contents, "utf8");
}

const CONFIG = `project: myapp
providers:
  local:
    adapter: sops
`;

const SCHEMA = `keys:
  LOG_LEVEL: info
  REGION: !required
  FEATURE_X: !optional
  DATABASE_PASSWORD: !required
`;

async function scaffold(): Promise<void> {
  await write(".keyshelf/config.yaml", CONFIG);
  await write(".keyshelf/web/schema.yaml", SCHEMA);
  await write(
    ".keyshelf/web/staging.yaml",
    `provider: local
keys:
  REGION: eu-west-1
  DATABASE_PASSWORD: !secret
`
  );
}

function expectCode(p: Promise<unknown>, code: string, fields?: Record<string, unknown>) {
  return p.then(
    () => {
      throw new Error(`expected KeyshelfError ${code} but resolved`);
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(KeyshelfError);
      const err = error as KeyshelfError;
      expect(err.code).toBe(code);
      if (fields) expect(err.fields).toMatchObject(fields);
    }
  );
}

describe("loadEnvironment", () => {
  it("loads config, schema, and environment into a model with filesystem-derived identity", async () => {
    await scaffold();
    const loaded = await loadEnvironment(root, "web", "staging");

    expect(loaded.config.project).toBe("myapp");
    expect(loaded.config.providers.local.adapter).toBe("sops");

    expect(loaded.schema.keys.LOG_LEVEL).toEqual({ kind: "config", default: "info" });
    expect(loaded.schema.keys.REGION).toEqual({ kind: "required" });
    expect(loaded.schema.keys.FEATURE_X).toEqual({ kind: "optional" });

    expect(loaded.environment.shelf).toBe("web");
    expect(loaded.environment.name).toBe("staging");
    expect(loaded.environment.provider).toBe("local");
    expect(loaded.environment.keys.REGION).toEqual({ kind: "config", value: "eu-west-1" });
    expect(loaded.environment.keys.DATABASE_PASSWORD).toMatchObject({ kind: "secret" });
  });

  it("throws NOT_INITIALIZED when no .keyshelf exists", async () => {
    await expectCode(loadEnvironment(root, "web", "staging"), "NOT_INITIALIZED");
  });

  it("throws SHELF_NOT_FOUND for an unknown shelf", async () => {
    await scaffold();
    await expectCode(loadEnvironment(root, "ghost", "staging"), "SHELF_NOT_FOUND", {
      shelf: "ghost"
    });
  });

  it("throws SCHEMA_NOT_FOUND when the shelf has no schema.yaml", async () => {
    await scaffold();
    await mkdir(path.join(root, ".keyshelf", "noschema"), { recursive: true });
    await write(".keyshelf/noschema/dev.yaml", "provider: local\nkeys: {}\n");
    await expectCode(loadEnvironment(root, "noschema", "dev"), "SCHEMA_NOT_FOUND", {
      shelf: "noschema"
    });
  });

  it("throws ENVIRONMENT_NOT_FOUND for a missing environment file", async () => {
    await scaffold();
    await expectCode(loadEnvironment(root, "web", "prod"), "ENVIRONMENT_NOT_FOUND", {
      environment: "web/prod"
    });
  });

  it("throws MALFORMED_FILE with file + reason for unparseable config", async () => {
    await scaffold();
    await write(".keyshelf/config.yaml", "project: [unterminated\n");
    let err: KeyshelfError | undefined;
    await loadEnvironment(root, "web", "staging").catch((e: KeyshelfError) => {
      err = e;
    });
    expect(err).toBeInstanceOf(KeyshelfError);
    expect(err!.code).toBe("MALFORMED_FILE");
    expect(err!.fields.file).toContain("config.yaml");
    expect(typeof err!.fields.reason).toBe("string");
  });

  it("throws MALFORMED_FILE for an unparseable environment file", async () => {
    await scaffold();
    await write(".keyshelf/web/staging.yaml", "provider: local\nkeys: {bad\n");
    await expectCode(loadEnvironment(root, "web", "staging"), "MALFORMED_FILE", {});
  });

  it("loads an environment with no provider field (provider is undefined)", async () => {
    // provider: is optional at load time; the conditional rule (required iff a
    // local !secret) is enforced in validate, not the loader.
    await scaffold();
    await write(".keyshelf/web/staging.yaml", "keys:\n  REGION: eu\n");
    const loaded = await loadEnvironment(root, "web", "staging");
    expect(loaded.environment.provider).toBeUndefined();
    expect(loaded.environment.keys.REGION).toEqual({ kind: "config", value: "eu" });
  });

  it("throws MALFORMED_FILE for a present-but-empty provider field", async () => {
    // A provider key that is present but not a non-empty string is still malformed.
    await scaffold();
    await write(".keyshelf/web/staging.yaml", "provider:\nkeys:\n  REGION: eu\n");
    await expectCode(loadEnvironment(root, "web", "staging"), "MALFORMED_FILE", {});
  });

  it("throws MALFORMED_FILE for config missing the required project field", async () => {
    await scaffold();
    await write(".keyshelf/config.yaml", "providers:\n  local:\n    adapter: sops\n");
    await expectCode(loadEnvironment(root, "web", "staging"), "MALFORMED_FILE", {});
  });
});

describe("loadEnvironment: !ref key references", () => {
  it("parses !ref { shelf } into a key reference with shelf only (key/stage default later)", async () => {
    await scaffold();
    await write(
      ".keyshelf/web/staging.yaml",
      `provider: local
keys:
  REGION: eu-west-1
  DATABASE_PASSWORD: !ref { shelf: shared }
`
    );
    const loaded = await loadEnvironment(root, "web", "staging");
    expect(loaded.environment.keys.DATABASE_PASSWORD).toEqual({
      kind: "ref",
      reference: { shelf: "shared" }
    });
  });

  it("captures explicit key and stage on a !ref", async () => {
    await scaffold();
    await write(
      ".keyshelf/web/staging.yaml",
      `provider: local
keys:
  DATABASE_PASSWORD: !ref { shelf: shared, key: SHARED_DB, stage: production }
`
    );
    const loaded = await loadEnvironment(root, "web", "staging");
    expect(loaded.environment.keys.DATABASE_PASSWORD).toEqual({
      kind: "ref",
      reference: { shelf: "shared", key: "SHARED_DB", stage: "production" }
    });
  });

  it("throws MALFORMED_FILE for a !ref missing the required shelf field", async () => {
    await scaffold();
    await write(
      ".keyshelf/web/staging.yaml",
      `provider: local
keys:
  DATABASE_PASSWORD: !ref { key: SHARED_DB }
`
    );
    await expectCode(loadEnvironment(root, "web", "staging"), "MALFORMED_FILE", {});
  });

  it("throws MALFORMED_FILE for a scalar !ref (it must be a mapping)", async () => {
    await scaffold();
    await write(
      ".keyshelf/web/staging.yaml",
      `provider: local
keys:
  DATABASE_PASSWORD: !ref shared
`
    );
    await expectCode(loadEnvironment(root, "web", "staging"), "MALFORMED_FILE", {});
  });
});

describe("listEnvironments", () => {
  it("throws NOT_INITIALIZED when no .keyshelf exists", async () => {
    await expectCode(listEnvironments(root), "NOT_INITIALIZED");
  });

  it("lists every {shelf}/{stage} across all shelves, ignoring schema and secrets files", async () => {
    await scaffold();
    await write(".keyshelf/web/prod.yaml", "provider: local\nkeys: {}\n");
    await write(".keyshelf/web/staging.secrets.yaml", "enc: stuff\n");
    await write(".keyshelf/api/schema.yaml", "keys: {}\n");
    await write(".keyshelf/api/dev.yaml", "provider: local\nkeys: {}\n");

    const envs = await listEnvironments(root);
    const ids = envs.map((e) => `${e.shelf}/${e.stage}`).sort();
    expect(ids).toEqual(["api/dev", "web/prod", "web/staging"]);
  });
});
