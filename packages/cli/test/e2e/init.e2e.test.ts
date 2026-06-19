import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { makeTmpDir, removeDir, runKeyshelf } from "./helpers.js";

async function readYaml<T = Record<string, unknown>>(
  dir: string,
  ...segments: string[]
): Promise<T> {
  return parse(await readFile(path.join(dir, ...segments), "utf8")) as T;
}

describe("keyshelf init", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await makeTmpDir();
  });

  afterEach(async () => {
    await removeDir(cwd);
  });

  it("scaffolds config.yaml with the directory name and a default local sops provider", async () => {
    const { code } = await runKeyshelf(["init"], { cwd });
    expect(code).toBe(0);

    const config = await readYaml<{ project: string; providers: { local: { adapter: string } } }>(
      cwd,
      ".keyshelf",
      "config.yaml"
    );
    expect(config.project).toBe(path.basename(cwd));
    expect(config.providers.local.adapter).toBe("sops");
  });

  it('creates a default "app" shelf with an empty schema.yaml', async () => {
    await runKeyshelf(["init"], { cwd });

    const schema = await readYaml(cwd, ".keyshelf", "app", "schema.yaml");
    expect(schema).toEqual({ keys: {} });
  });

  it("honors --project and --shelf overrides", async () => {
    const { code } = await runKeyshelf(["init", "--project", "billing", "--shelf", "web"], { cwd });
    expect(code).toBe(0);

    const config = await readYaml(cwd, ".keyshelf", "config.yaml");
    expect(config.project).toBe("billing");
    await expect(readYaml(cwd, ".keyshelf", "web", "schema.yaml")).resolves.toEqual({ keys: {} });
  });

  it("emits a structured JSON result with --json", async () => {
    const { code, stdout } = await runKeyshelf(["init", "--json"], { cwd });
    expect(code).toBe(0);

    const result = JSON.parse(stdout);
    expect(result).toMatchObject({
      project: path.basename(cwd),
      shelf: "app",
      created: ["config.yaml", "app/schema.yaml"]
    });
  });

  it("refuses to clobber an existing project with ALREADY_INITIALIZED", async () => {
    await runKeyshelf(["init"], { cwd });

    const { code, stdout } = await runKeyshelf(["init", "--json"], { cwd });
    expect(code).not.toBe(0);
    expect(JSON.parse(stdout).error.code).toBe("ALREADY_INITIALIZED");
  });

  it("overwrites an existing project with --force", async () => {
    await runKeyshelf(["init", "--project", "first"], { cwd });

    const { code } = await runKeyshelf(["init", "--project", "second", "--force"], { cwd });
    expect(code).toBe(0);

    const config = await readYaml(cwd, ".keyshelf", "config.yaml");
    expect(config.project).toBe("second");
  });

  it("exposes --help and exits zero", async () => {
    const { code, stdout } = await runKeyshelf(["init", "--help"], { cwd });
    expect(code).toBe(0);
    expect(stdout).toContain("init");
  });
});
