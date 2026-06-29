import { readFile, mkdir, writeFile } from "node:fs/promises";
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

async function read(rel: string): Promise<string> {
  return readFile(path.join(cwd, rel), "utf8");
}

const CONFIG = `project: myapp
providers:
  local:
    adapter: sops
  store:
    adapter: fake
  bogus:
    adapter: no-such-adapter
`;

const SCHEMA = `keys:
  LOG_LEVEL: info
  REGION: !required
  DATABASE_PASSWORD: !required
  TRICKY: !optional
`;

// Two keys + a provider line, so we can assert the in-place edit preserves the rest.
const ENV = `provider: store
keys:
  LOG_LEVEL: debug
  REGION: eu-west-1
`;

async function scaffold(): Promise<void> {
  await write(".keyshelf/config.yaml", CONFIG);
  await write(".keyshelf/web/schema.yaml", SCHEMA);
  await write(".keyshelf/web/staging.yaml", ENV);
}

describe("keyshelf set <KEY> <shelf>/<stage>", () => {
  it("reads a plaintext value from stdin and writes it under keys, preserving others", async () => {
    await scaffold();
    const { code, stdout } = await runKeyshelf(
      ["set", "DATABASE_PASSWORD", "web/staging", "--json"],
      {
        cwd,
        input: "plainpw"
      }
    );
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      key: "DATABASE_PASSWORD",
      environment: "web/staging",
      secret: false
    });

    const envText = await read(".keyshelf/web/staging.yaml");
    // In-place edit preserves the other keys and the provider line.
    expect(envText).toContain("provider: store");
    expect(envText).toContain("LOG_LEVEL: debug");
    expect(envText).toContain("REGION: eu-west-1");
    expect(envText).toContain("DATABASE_PASSWORD: plainpw");
  });

  it("round-trips an adversarial plaintext value with spaces, = and quotes", async () => {
    await scaffold();
    // An env that already satisfies the required keys, so run resolves cleanly.
    await write(
      ".keyshelf/web/staging.yaml",
      "provider: store\nkeys:\n  REGION: eu-west-1\n  DATABASE_PASSWORD: pw\n"
    );
    const value = 'a "quoted" = value with spaces';
    const { code } = await runKeyshelf(["set", "TRICKY", "web/staging"], { cwd, input: value });
    expect(code).toBe(0);
    // run injects the resolved value; the child must see it byte-exact.
    const { stdout } = await runKeyshelf(
      [
        "run",
        "web/staging",
        "--",
        "node",
        "-e",
        "process.stdout.write(String(process.env.TRICKY))"
      ],
      { cwd }
    );
    expect(stdout).toBe(value);
  });

  it("never modifies the schema and rejects a key not in the schema with UNKNOWN_KEY", async () => {
    await scaffold();
    const schemaBefore = await read(".keyshelf/web/schema.yaml");
    const { code, stdout } = await runKeyshelf(["set", "NOT_DECLARED", "web/staging", "--json"], {
      cwd,
      input: "whatever"
    });
    expect(code).not.toBe(0);
    expect(JSON.parse(stdout).error).toMatchObject({ code: "UNKNOWN_KEY", key: "NOT_DECLARED" });
    // Schema file is byte-for-byte unchanged.
    expect(await read(".keyshelf/web/schema.yaml")).toBe(schemaBefore);
    // The env file is not given the rejected key either.
    expect(await read(".keyshelf/web/staging.yaml")).not.toContain("NOT_DECLARED");
  });

  it("fails with NO_INPUT when stdin provides no value", async () => {
    await scaffold();
    const { code, stdout } = await runKeyshelf(["set", "REGION", "web/staging", "--json"], {
      cwd,
      input: ""
    });
    expect(code).not.toBe(0);
    expect(JSON.parse(stdout).error.code).toBe("NO_INPUT");
  });

  it("surfaces ENVIRONMENT_NOT_FOUND for a missing environment", async () => {
    await scaffold();
    const { code, stdout } = await runKeyshelf(["set", "REGION", "web/prod", "--json"], {
      cwd,
      input: "x"
    });
    expect(code).not.toBe(0);
    expect(JSON.parse(stdout).error.code).toBe("ENVIRONMENT_NOT_FOUND");
  });

  it("rejects a malformed <shelf>/<stage> argument with MALFORMED_FILE", async () => {
    await scaffold();
    const { code, stdout } = await runKeyshelf(["set", "REGION", "webstaging", "--json"], {
      cwd,
      input: "x"
    });
    expect(code).not.toBe(0);
    expect(JSON.parse(stdout).error.code).toBe("MALFORMED_FILE");
  });

  it("exposes --help and exits zero", async () => {
    const { code, stdout } = await runKeyshelf(["set", "--help"], { cwd });
    expect(code).toBe(0);
    expect(stdout).toContain("set");
  });
});

describe("keyshelf set <KEY> <shelf>/<stage> --secret", () => {
  it("writes the value to the store and records only a bare !secret reference", async () => {
    await scaffold();
    const secret = "s3cr3t-value";
    const { code, stdout } = await runKeyshelf(
      ["set", "DATABASE_PASSWORD", "web/staging", "--secret", "--json"],
      {
        cwd,
        input: secret
      }
    );
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      key: "DATABASE_PASSWORD",
      environment: "web/staging",
      secret: true
    });

    const envText = await read(".keyshelf/web/staging.yaml");
    // The plaintext value never lands in the environment file — only a !secret reference.
    expect(envText).not.toContain(secret);
    expect(envText).toContain("!secret");
    expect(envText).toContain("DATABASE_PASSWORD");
    // Other keys + provider survive.
    expect(envText).toContain("provider: store");
    expect(envText).toContain("LOG_LEVEL: debug");

    // The value lives in the fake store under the convention name.
    const store = JSON.parse(await read(".keyshelf/.fake-store.json"));
    expect(store["keyshelf__myapp__web__staging__DATABASE_PASSWORD"]).toBe(secret);
  });

  it("round-trips: set --secret then run resolves the stored value via fake", async () => {
    await scaffold();
    const secret = "round-trip-secret";
    const set = await runKeyshelf(["set", "DATABASE_PASSWORD", "web/staging", "--secret"], {
      cwd,
      input: secret
    });
    expect(set.code).toBe(0);

    const { code, stdout } = await runKeyshelf(
      [
        "run",
        "web/staging",
        "--",
        "node",
        "-e",
        "process.stdout.write(String(process.env.DATABASE_PASSWORD))"
      ],
      { cwd }
    );
    expect(code).toBe(0);
    expect(stdout).toBe(secret);
  });

  it("round-trips: set --secret then validate passes", async () => {
    await scaffold();
    const set = await runKeyshelf(["set", "DATABASE_PASSWORD", "web/staging", "--secret"], {
      cwd,
      input: "pw"
    });
    expect(set.code).toBe(0);
    const { code, stdout } = await runKeyshelf(["validate", "web/staging", "--json"], { cwd });
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ environment: "web/staging", valid: true });
  });

  it("set --secret on a non-versioned provider (fake) records a floating bare !secret", async () => {
    // The fake adapter does not version its store, so it reports no version and
    // the reference stays floating — no version: line, even by default (ADR-0009).
    await scaffold();
    const { code, stdout } = await runKeyshelf(
      ["set", "DATABASE_PASSWORD", "web/staging", "--secret", "--json"],
      { cwd, input: "pw" }
    );
    expect(code).toBe(0);
    expect(JSON.parse(stdout).version).toBeUndefined();
    const env = await read(".keyshelf/web/staging.yaml");
    // Exactly a bare tag — no `null` token, no trailing whitespace (issue #254).
    expect(env).toMatch(/^ {2}DATABASE_PASSWORD: !secret$/m);
    expect(env).not.toContain("!secret null");
    expect(env).not.toContain("version");
  });

  it("set --secret --floating records a bare !secret (no version)", async () => {
    await scaffold();
    const { code } = await runKeyshelf(
      ["set", "DATABASE_PASSWORD", "web/staging", "--secret", "--floating"],
      { cwd, input: "pw" }
    );
    expect(code).toBe(0);
    const env = await read(".keyshelf/web/staging.yaml");
    // Exactly a bare tag — no `null` token, no trailing whitespace (issue #254).
    expect(env).toMatch(/^ {2}DATABASE_PASSWORD: !secret$/m);
    expect(env).not.toContain("!secret null");
    expect(env).not.toContain("version");
  });

  it("rejects --pin-latest on a non-versioned provider (fake) with ADAPTER_ERROR", async () => {
    await scaffold();
    await runKeyshelf(["set", "DATABASE_PASSWORD", "web/staging", "--secret"], {
      cwd,
      input: "pw"
    });
    const { code, stdout } = await runKeyshelf(
      ["set", "DATABASE_PASSWORD", "web/staging", "--pin-latest", "--json"],
      { cwd }
    );
    expect(code).not.toBe(0);
    expect(JSON.parse(stdout).error.code).toBe("ADAPTER_ERROR");
  });

  it("rejects --pin-latest on a key that is not a !secret with UNKNOWN_KEY", async () => {
    await scaffold();
    // REGION is plaintext config, not a secret.
    const { code, stdout } = await runKeyshelf(
      ["set", "REGION", "web/staging", "--pin-latest", "--json"],
      { cwd }
    );
    expect(code).not.toBe(0);
    expect(JSON.parse(stdout).error.code).toBe("UNKNOWN_KEY");
  });

  it("rejects --secret combined with --pin-latest", async () => {
    await scaffold();
    const { code } = await runKeyshelf(
      ["set", "DATABASE_PASSWORD", "web/staging", "--secret", "--pin-latest"],
      { cwd, input: "pw" }
    );
    expect(code).not.toBe(0);
  });

  it("rejects --secret on a provider whose adapter is unregistered with ADAPTER_UNAVAILABLE", async () => {
    await scaffold();
    // The `bogus` provider names an adapter no branch in the registry handles.
    await write(".keyshelf/web/staging.yaml", "provider: bogus\nkeys:\n  REGION: eu-west-1\n");
    const { code, stdout } = await runKeyshelf(
      ["set", "DATABASE_PASSWORD", "web/staging", "--secret", "--json"],
      {
        cwd,
        input: "pw"
      }
    );
    expect(code).not.toBe(0);
    expect(JSON.parse(stdout).error.code).toBe("ADAPTER_UNAVAILABLE");
    // Nothing recorded in the environment file on a failed write.
    expect(await read(".keyshelf/web/staging.yaml")).not.toContain("!secret");
  });
});
