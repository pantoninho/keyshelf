import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTmpDir, removeDir, runKeyshelf } from "./helpers.js";

/**
 * Regression fixture for issue #270: `set` on a key bound to an explicit
 * `!secret { ref: ... }`, and `set`'s edits to the rest of the environment file.
 * Runs the real binary against the file-backed `fake` adapter — no cloud.
 */

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

const ENV_FILE = ".keyshelf/app/environments/production.yaml";
const STORE_FILE = ".keyshelf/.fake-store.json";
const PINNED = "keyshelf__myproj__production__api-key";
const CONVENTION = "keyshelf__myproj__app__production__API_KEY";

async function scaffold(env: string, store: Record<string, string> = {}): Promise<void> {
  await write(
    ".keyshelf/config.yaml",
    "project: myproj\nproviders:\n  store:\n    adapter: fake\n"
  );
  await write(
    ".keyshelf/app/schema.yaml",
    "keys:\n  API_KEY: !optional\n  A_KEY: !optional\n  B_KEY: !optional\n  C_KEY: !optional\n  NEW_KEY: !optional\n  PLAIN: !optional\n"
  );
  await write(ENV_FILE, env);
  await write(STORE_FILE, JSON.stringify(store, null, 2));
}

async function store(): Promise<Record<string, string>> {
  return JSON.parse(await read(STORE_FILE)) as Record<string, string>;
}

async function resolved(key: string): Promise<string> {
  const { stdout } = await runKeyshelf(
    [
      "run",
      "app/production",
      "--",
      "node",
      "-e",
      `process.stdout.write(String(process.env.${key}))`
    ],
    { cwd }
  );
  return stdout;
}

describe("set --secret on a key pinned with !secret { ref } (#270 a)", () => {
  it("writes the new value to the referenced secret and keeps the ref binding", async () => {
    await scaffold(`provider: store\nkeys:\n  API_KEY: !secret { ref: ${PINNED} }\n`, {
      [PINNED]: "old-value"
    });

    const { code, stdout } = await runKeyshelf(
      ["set", "API_KEY", "app/production", "--secret", "--json"],
      { cwd, input: "rotated-value" }
    );
    expect(code).toBe(0);

    // The pinned secret holds the new value; no convention-named copy appears.
    const after = await store();
    expect(after[PINNED]).toBe("rotated-value");
    expect(after).not.toHaveProperty(CONVENTION);
    expect(JSON.parse(stdout)).toMatchObject({ key: "API_KEY", secret: true, secretRef: PINNED });

    // The binding is unchanged (the fake does not version, so there is no pin to
    // update), and resolves to the rotated value.
    expect(await read(ENV_FILE)).toBe(
      `provider: store\nkeys:\n  API_KEY: !secret { ref: ${PINNED} }\n`
    );
    expect(await resolved("API_KEY")).toBe("rotated-value");
  });

  it("keeps the ref of a multi-line block-form binding", async () => {
    await scaffold(
      `provider: store\nkeys:\n  API_KEY: !secret\n    ref: ${PINNED}\n    version: 2\n  PLAIN: kept\n`,
      { [PINNED]: "old-value" }
    );

    const { code, stdout } = await runKeyshelf(["set", "API_KEY", "app/production", "--secret"], {
      cwd,
      input: "rotated-value"
    });
    expect(code).toBe(0);
    // The human line names the secret that was written.
    expect(stdout).toContain(PINNED);
    expect((await store())[PINNED]).toBe("rotated-value");
    const env = await read(ENV_FILE);
    expect(env).toContain(`ref: ${PINNED}`);
    expect(env).toContain("  PLAIN: kept\n");
  });

  it("refuses with SECRET_NOT_FOUND, naming the ref, when the pinned secret does not exist", async () => {
    const env = `provider: store\nkeys:\n  API_KEY: !secret { ref: ${PINNED} }\n`;
    await scaffold(env);

    const { code, stdout } = await runKeyshelf(
      ["set", "API_KEY", "app/production", "--secret", "--json"],
      { cwd, input: "rotated-value" }
    );
    expect(code).not.toBe(0);
    const { error } = JSON.parse(stdout);
    expect(error.code).toBe("SECRET_NOT_FOUND");
    expect(error.message).toContain(PINNED);
    // Nothing written anywhere.
    expect(await store()).toEqual({});
    expect(await read(ENV_FILE)).toBe(env);
  });

  it("--rebind opts into the convention name and drops the ref", async () => {
    await scaffold(`provider: store\nkeys:\n  API_KEY: !secret { ref: ${PINNED} }\n`, {
      [PINNED]: "old-value"
    });

    const { code } = await runKeyshelf(
      ["set", "API_KEY", "app/production", "--secret", "--rebind"],
      { cwd, input: "rotated-value" }
    );
    expect(code).toBe(0);
    const after = await store();
    expect(after[CONVENTION]).toBe("rotated-value");
    expect(after[PINNED]).toBe("old-value");
    const env = await read(ENV_FILE);
    expect(env).not.toContain("ref:");
    expect(env).toMatch(/^ {2}API_KEY: !secret$/m);
    expect(await resolved("API_KEY")).toBe("rotated-value");
  });

  it("warns that --rebind has no effect on a key with no explicit ref, and still writes", async () => {
    await scaffold("provider: store\nkeys:\n  API_KEY: !secret\n");
    const { code, stderr } = await runKeyshelf(
      ["set", "API_KEY", "app/production", "--secret", "--rebind"],
      { cwd, input: "v" }
    );
    expect(code).toBe(0);
    expect(stderr).toContain("--rebind has no effect");
    expect((await store())[CONVENTION]).toBe("v");
  });

  it("rejects --rebind without --secret", async () => {
    await scaffold(`provider: store\nkeys:\n  API_KEY: !secret { ref: ${PINNED} }\n`, {
      [PINNED]: "old-value"
    });
    const { code } = await runKeyshelf(["set", "API_KEY", "app/production", "--rebind"], {
      cwd,
      input: "x"
    });
    expect(code).not.toBe(0);
  });
});

describe("set edits only the named key's lines (#270 b, c)", () => {
  const BEFORE = `provider: store
keys:
  # group one
  A_KEY: !secret
  # Comment documenting B_KEY (line 1)
  # comment line 2
  B_KEY: !secret

  C_KEY: !secret # trailing note
  API_KEY: !secret { ref: ${PINNED} }
  PLAIN: "value"
`;

  it("leaves other keys' bare !secret, comments and blank lines byte-identical", async () => {
    await scaffold(BEFORE, { [PINNED]: "old" });
    const { code } = await runKeyshelf(["set", "B_KEY", "app/production", "--secret"], {
      cwd,
      input: "b-value"
    });
    expect(code).toBe(0);
    // B_KEY was already a bare !secret, so the file is unchanged.
    expect(await read(ENV_FILE)).toBe(BEFORE);
  });

  it("rewrites only the target line when its representation changes", async () => {
    await scaffold(BEFORE, { [PINNED]: "old" });
    const { code } = await runKeyshelf(["set", "B_KEY", "app/production"], {
      cwd,
      input: "plain now"
    });
    expect(code).toBe(0);
    expect(await read(ENV_FILE)).toBe(BEFORE.replace("  B_KEY: !secret\n", "  B_KEY: plain now\n"));
  });

  it("appends a new key at the end of keys: without touching anything else", async () => {
    await scaffold(BEFORE, { [PINNED]: "old" });
    const { code } = await runKeyshelf(["set", "NEW_KEY", "app/production", "--secret"], {
      cwd,
      input: "new-value"
    });
    expect(code).toBe(0);
    expect(await read(ENV_FILE)).toBe(`${BEFORE}  NEW_KEY: !secret\n`);
  });
});
