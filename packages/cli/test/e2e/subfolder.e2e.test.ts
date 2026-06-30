import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { makeTmpDir, removeDir, runKeyshelf } from "./helpers.js";

// A project root with a nested subfolder, so we can run keyshelf from deep
// inside the tree and assert it discovers the same project root that running
// from the root would (the way git/npm walk up to find their marker).
let root: string;
let nested: string;

beforeEach(async () => {
  root = await makeTmpDir();
  nested = path.join(root, "services", "api", "src");
  await mkdir(nested, { recursive: true });
});

afterEach(async () => {
  await removeDir(root);
});

async function write(rel: string, contents: string): Promise<void> {
  const full = path.join(root, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, contents, "utf8");
}

const CONFIG = `project: myapp
providers:
  store:
    adapter: fake
`;

const SCHEMA = `keys:
  LOG_LEVEL: info
  REGION: !required
`;

const ENV = `provider: store
keys:
  REGION: eu-west-1
`;

async function scaffold(): Promise<void> {
  await write(".keyshelf/config.yaml", CONFIG);
  await write(".keyshelf/web/schema.yaml", SCHEMA);
  await write(".keyshelf/web/environments/staging.yaml", ENV);
}

describe("running keyshelf from a subfolder", () => {
  it("ls produces identical output from the root and from a nested subfolder", async () => {
    await scaffold();
    const fromRoot = await runKeyshelf(["ls", "--json"], { cwd: root });
    const fromNested = await runKeyshelf(["ls", "--json"], { cwd: nested });

    expect(fromRoot.code).toBe(0);
    expect(fromNested.code).toBe(0);
    expect(JSON.parse(fromNested.stdout)).toEqual(JSON.parse(fromRoot.stdout));
  });

  it("validate resolves the same project root from a nested subfolder", async () => {
    await scaffold();
    const fromRoot = await runKeyshelf(["validate", "--json"], { cwd: root });
    const fromNested = await runKeyshelf(["validate", "--json"], { cwd: nested });

    expect(fromRoot.code).toBe(0);
    expect(fromNested.code).toBe(0);
    expect(JSON.parse(fromNested.stdout)).toEqual(JSON.parse(fromRoot.stdout));
  });

  it("run resolves config from a nested subfolder", async () => {
    await scaffold();
    const { code, stdout } = await runKeyshelf(
      ["run", "web/staging", "--", "node", "-e", "process.stdout.write(process.env.REGION ?? '')"],
      { cwd: nested }
    );
    expect(code).toBe(0);
    expect(stdout).toContain("eu-west-1");
  });

  it("set writes under the discovered project root, not cwd/.keyshelf", async () => {
    await scaffold();
    const { code } = await runKeyshelf(["set", "LOG_LEVEL", "web/staging"], {
      cwd: nested,
      input: "trace"
    });
    expect(code).toBe(0);

    // The write landed in the discovered project root...
    const env = parse(
      await readFile(path.join(root, ".keyshelf", "web", "environments", "staging.yaml"), "utf8")
    );
    expect(env.keys.LOG_LEVEL).toBe("trace");

    // ...and never created a stray .keyshelf under the subfolder.
    expect(existsSync(path.join(nested, ".keyshelf"))).toBe(false);
  });

  it("fails with NOT_INITIALIZED mentioning parents when run outside any project", async () => {
    const outside = await makeTmpDir();
    try {
      const { code, stdout } = await runKeyshelf(["ls", "--json"], { cwd: outside });
      expect(code).not.toBe(0);
      const result = JSON.parse(stdout);
      expect(result.error.code).toBe("NOT_INITIALIZED");
      expect(result.error.message).toContain("parent");
    } finally {
      await removeDir(outside);
    }
  });

  it("init still scaffolds in the current working directory, not the discovered ancestor", async () => {
    await scaffold();
    // init from the nested subfolder must NOT walk up to the existing root; it
    // scaffolds a brand-new project right here in the subfolder.
    const { code } = await runKeyshelf(["init", "--project", "sub"], { cwd: nested });
    expect(code).toBe(0);

    expect(existsSync(path.join(nested, ".keyshelf", "config.yaml"))).toBe(true);
    const config = parse(await readFile(path.join(nested, ".keyshelf", "config.yaml"), "utf8"));
    expect(config.project).toBe("sub");
  });
});
