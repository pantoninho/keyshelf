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
`;

/**
 * Scaffold the issue's worked example: a backend shelf whose schema declares all
 * six status cases for the production environment.
 */
async function scaffold(): Promise<void> {
  await write(".keyshelf/config.yaml", CONFIG);
  await write(
    ".keyshelf/backend/schema.yaml",
    `keys:
  DATABASE_URL: !required
  LOG_LEVEL: info
  REGION: eu-west-1
  SUPABASE_KEY: !required
  API_TOKEN: !required
  DEBUG: !optional
`
  );
  await write(
    ".keyshelf/backend/production.yaml",
    `provider: local
keys:
  DATABASE_URL: !secret
  LOG_LEVEL: debug
  SUPABASE_KEY: !ref
    shelf: supabase
`
  );
  // A target shelf for the !ref — present so nothing is malformed, but ls never
  // follows the reference, so its contents are irrelevant to the view.
  await write(".keyshelf/supabase/schema.yaml", "keys:\n  SUPABASE_KEY: !required\n");
  await write(
    ".keyshelf/supabase/production.yaml",
    "provider: local\nkeys:\n  SUPABASE_KEY: !secret\n"
  );
}

// eslint-disable-next-line no-control-regex
const ANSI = /\[/;

describe("keyshelf ls <shelf>/<stage> (environment key view)", () => {
  it("returns the key-centric --json shape with the raw status enum", async () => {
    await scaffold();
    const { code, stdout } = await runKeyshelf(["ls", "backend/production", "--json"], { cwd });
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      shelf: "backend",
      stage: "production",
      keys: [
        { key: "DATABASE_URL", presence: "required", status: "secret" },
        { key: "LOG_LEVEL", presence: "default", status: "config" },
        { key: "REGION", presence: "default", status: "default" },
        {
          key: "SUPABASE_KEY",
          presence: "required",
          status: "ref",
          reference: { shelf: "supabase", stage: "production", key: "SUPABASE_KEY" }
        },
        { key: "API_TOKEN", presence: "required", status: "missing" },
        { key: "DEBUG", presence: "optional", status: "unset" }
      ]
    });
  });

  it("prints a borderless aligned table in schema declaration order", async () => {
    await scaffold();
    const { code, stdout } = await runKeyshelf(["ls", "backend/production"], { cwd });
    expect(code).toBe(0);
    const lines = stdout.trimEnd().split("\n");
    expect(lines[0]).toMatch(/^KEY\s+PRESENCE\s+STATUS$/);
    expect(lines.slice(1)).toEqual([
      "DATABASE_URL   required   ✓ secret",
      "LOG_LEVEL      default    ✓ config",
      "REGION         default    — default",
      "SUPABASE_KEY   required   ✓ ref → supabase/production",
      "API_TOKEN      required   ✗ missing",
      "DEBUG          optional   — unset"
    ]);
  });

  it("never prints any key value (config or secret)", async () => {
    await scaffold();
    const { stdout } = await runKeyshelf(["ls", "backend/production"], { cwd });
    // LOG_LEVEL's committed config value is `debug`; the view shows status, not value.
    expect(stdout).not.toContain("debug");
    expect(stdout).not.toContain("eu-west-1");
    expect(stdout).not.toContain("info");
  });

  it("prints 'No keys declared.' for an empty schema", async () => {
    await write(".keyshelf/config.yaml", CONFIG);
    await write(".keyshelf/empty/schema.yaml", "keys: {}\n");
    await write(".keyshelf/empty/production.yaml", "provider: local\nkeys: {}\n");
    const { code, stdout } = await runKeyshelf(["ls", "empty/production"], { cwd });
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("No keys declared.");
  });

  it("emits an empty keys array for an empty schema under --json", async () => {
    await write(".keyshelf/config.yaml", CONFIG);
    await write(".keyshelf/empty/schema.yaml", "keys: {}\n");
    await write(".keyshelf/empty/production.yaml", "provider: local\nkeys: {}\n");
    const { code, stdout } = await runKeyshelf(["ls", "empty/production", "--json"], { cwd });
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ shelf: "empty", stage: "production", keys: [] });
  });

  it("disables colour and glyphless on a non-TTY (no ANSI escapes when piped)", async () => {
    await scaffold();
    const { stdout } = await runKeyshelf(["ls", "backend/production"], { cwd });
    expect(ANSI.test(stdout)).toBe(false);
  });

  it("disables colour when NO_COLOR is set", async () => {
    await scaffold();
    const { stdout } = await runKeyshelf(["ls", "backend/production"], {
      cwd,
      env: { NO_COLOR: "1", FORCE_COLOR: "1" }
    });
    expect(ANSI.test(stdout)).toBe(false);
  });

  it("fails fast with SHELF_NOT_FOUND for an unknown shelf", async () => {
    await scaffold();
    const { code, stdout } = await runKeyshelf(["ls", "ghost/production", "--json"], { cwd });
    expect(code).not.toBe(0);
    expect(JSON.parse(stdout).error).toMatchObject({ code: "SHELF_NOT_FOUND", shelf: "ghost" });
  });

  it("fails fast with ENVIRONMENT_NOT_FOUND for an unknown stage", async () => {
    await scaffold();
    const { code, stdout } = await runKeyshelf(["ls", "backend/ghost", "--json"], { cwd });
    expect(code).not.toBe(0);
    expect(JSON.parse(stdout).error.code).toBe("ENVIRONMENT_NOT_FOUND");
  });

  it("fails fast with MALFORMED_FILE for a broken environment file", async () => {
    await write(".keyshelf/config.yaml", CONFIG);
    await write(".keyshelf/backend/schema.yaml", "keys:\n  A: !required\n");
    await write(".keyshelf/backend/production.yaml", "provider: local\nkeys:\n  A: : :\n");
    const { code, stdout } = await runKeyshelf(["ls", "backend/production", "--json"], { cwd });
    expect(code).not.toBe(0);
    expect(JSON.parse(stdout).error.code).toBe("MALFORMED_FILE");
  });

  it("fails fast with MALFORMED_FILE for a malformed target argument", async () => {
    await scaffold();
    const { code, stdout } = await runKeyshelf(["ls", "no-slash", "--json"], { cwd });
    expect(code).not.toBe(0);
    expect(JSON.parse(stdout).error.code).toBe("MALFORMED_FILE");
  });
});

/**
 * A project backed by the gcp adapter, which implements offline `metadata()`.
 * No credentials are configured: `ls` must build the adapter and compute the
 * Secret Manager address without ever reaching the network (ADR-0008).
 */
async function scaffoldGcp(): Promise<void> {
  await write(
    ".keyshelf/config.yaml",
    `project: myapp
providers:
  cloud:
    adapter: gcp
    projectId: my-gcp-project
`
  );
  await write(
    ".keyshelf/backend/schema.yaml",
    `keys:
  DATABASE_PASSWORD: !required
  SHARED_TOKEN: !required
  LOG_LEVEL: info
`
  );
  await write(
    ".keyshelf/backend/production.yaml",
    `provider: cloud
keys:
  DATABASE_PASSWORD: !secret
  SHARED_TOKEN: !secret
    ref: shared-secret
  LOG_LEVEL: debug
`
  );
}

describe("keyshelf ls <shelf>/<stage> (adapter metadata, offline)", () => {
  it("always includes the gcp address in --json for secret keys (omits it elsewhere)", async () => {
    await scaffoldGcp();
    const { code, stdout } = await runKeyshelf(["ls", "backend/production", "--json"], { cwd });
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.keys).toEqual([
      {
        key: "DATABASE_PASSWORD",
        presence: "required",
        status: "secret",
        metadata: {
          adapter: "gcp",
          resource:
            "projects/my-gcp-project/secrets/keyshelf__myapp__backend__production__DATABASE_PASSWORD/versions/latest"
        }
      },
      {
        key: "SHARED_TOKEN",
        presence: "required",
        status: "secret",
        metadata: {
          adapter: "gcp",
          resource: "projects/my-gcp-project/secrets/shared-secret/versions/latest"
        }
      },
      { key: "LOG_LEVEL", presence: "default", status: "config" }
    ]);
  });

  it("surfaces a pinned !secret version in --json (version + pinned address, ADR-0009)", async () => {
    await scaffoldGcp();
    // Pin DATABASE_PASSWORD to version 3 and the foreign SHARED_TOKEN to 7.
    await write(
      ".keyshelf/backend/production.yaml",
      `provider: cloud
keys:
  DATABASE_PASSWORD: !secret { version: 3 }
  SHARED_TOKEN: !secret { ref: shared-secret, version: 7 }
  LOG_LEVEL: debug
`
    );
    const { code, stdout } = await runKeyshelf(["ls", "backend/production", "--json"], { cwd });
    expect(code).toBe(0);
    const keys = JSON.parse(stdout).keys;
    expect(keys[0]).toMatchObject({
      key: "DATABASE_PASSWORD",
      status: "secret",
      version: 3,
      metadata: {
        adapter: "gcp",
        resource:
          "projects/my-gcp-project/secrets/keyshelf__myapp__backend__production__DATABASE_PASSWORD/versions/3"
      }
    });
    expect(keys[1]).toMatchObject({
      key: "SHARED_TOKEN",
      version: 7,
      metadata: {
        adapter: "gcp",
        resource: "projects/my-gcp-project/secrets/shared-secret/versions/7"
      }
    });
  });

  it("shows a METADATA column behind --metadata; the default table omits it", async () => {
    await scaffoldGcp();
    const plain = await runKeyshelf(["ls", "backend/production"], { cwd });
    expect(plain.code).toBe(0);
    expect(plain.stdout).not.toContain("METADATA");
    expect(plain.stdout).not.toContain("versions/latest");
    expect(plain.stdout.split("\n")[0]).toMatch(/^KEY\s+PRESENCE\s+STATUS$/);

    const withMeta = await runKeyshelf(["ls", "backend/production", "--metadata"], { cwd });
    expect(withMeta.code).toBe(0);
    expect(withMeta.stdout.split("\n")[0]).toMatch(/^KEY\s+PRESENCE\s+STATUS\s+METADATA$/);
    expect(withMeta.stdout).toContain(
      "projects/my-gcp-project/secrets/keyshelf__myapp__backend__production__DATABASE_PASSWORD/versions/latest"
    );
    expect(withMeta.stdout).toContain(
      "projects/my-gcp-project/secrets/shared-secret/versions/latest"
    );
  });

  it("remains fully offline with no GCP credentials available (no network)", async () => {
    await scaffoldGcp();
    // Point ADC at a non-existent file and disable any ambient project so a
    // network/credential attempt would fail loudly. ls must still succeed.
    const { code, stdout } = await runKeyshelf(["ls", "backend/production", "--json"], {
      cwd,
      env: {
        GOOGLE_APPLICATION_CREDENTIALS: path.join(cwd, "does-not-exist.json"),
        GCLOUD_PROJECT: "",
        GOOGLE_CLOUD_PROJECT: ""
      }
    });
    expect(code).toBe(0);
    expect(JSON.parse(stdout).keys[0].metadata.adapter).toBe("gcp");
  });

  it("omits metadata for an adapter that does not implement it (sops --json)", async () => {
    await scaffold();
    const { code, stdout } = await runKeyshelf(["ls", "backend/production", "--json"], { cwd });
    expect(code).toBe(0);
    for (const key of JSON.parse(stdout).keys) {
      expect(key.metadata).toBeUndefined();
    }
  });

  it("--metadata leaves the table unchanged when no key has metadata (sops)", async () => {
    await scaffold();
    const { code, stdout } = await runKeyshelf(["ls", "backend/production", "--metadata"], { cwd });
    expect(code).toBe(0);
    // No adapter address to show, so the METADATA column stays empty (cells blank).
    expect(stdout).not.toContain("versions/latest");
  });
});
