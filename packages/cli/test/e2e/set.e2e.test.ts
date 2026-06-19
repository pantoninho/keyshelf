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

describe("keyshelf set <KEY> <shelf>/<env>", () => {
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

  it("rejects a malformed <shelf>/<env> argument with MALFORMED_FILE", async () => {
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

describe("keyshelf set <KEY> <shelf>/<env> --secret", () => {
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
    // The plaintext value never lands in the env file — only a !secret reference.
    expect(envText).not.toContain(secret);
    expect(envText).toContain("!secret");
    expect(envText).toContain("DATABASE_PASSWORD");
    // Other keys + provider survive.
    expect(envText).toContain("provider: store");
    expect(envText).toContain("LOG_LEVEL: debug");

    // The value lives in the fake store under the convention name.
    const store = JSON.parse(await read(".keyshelf/.fake-store.json"));
    expect(store["myapp-web-staging-DATABASE_PASSWORD"]).toBe(secret);
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
    // Nothing recorded in the env file on a failed write.
    expect(await read(".keyshelf/web/staging.yaml")).not.toContain("!secret");
  });
});
