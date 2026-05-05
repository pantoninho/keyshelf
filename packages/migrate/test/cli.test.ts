import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { copyFile, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { emitConfig } from "../src/emit.js";
import { loadFixture, fixturePath } from "./test-utils.js";

const CLI = join(process.cwd(), "dist", "cli.js");

describe("keyshelf-migrate CLI", () => {
  let roots: string[] = [];

  beforeAll(() => {
    expect(existsSync(CLI)).toBe(true);
  });

  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots = [];
  });

  it("yaml-to-typescript writes generated config to disk", async () => {
    const root = await copyFixture("basic");
    const result = spawnSync(process.execPath, [CLI, "yaml-to-typescript"], {
      cwd: root,
      encoding: "utf-8"
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Wrote");
    await expect(readFile(join(root, "keyshelf.config.ts"), "utf-8")).resolves.toBe(
      emitConfig(await loadFixture("basic"))
    );
  });

  it("yaml-to-typescript writes dry-run output to stdout", async () => {
    const root = await copyFixture("nested");
    const result = spawnSync(process.execPath, [CLI, "yaml-to-typescript", "--dry-run"], {
      cwd: root,
      encoding: "utf-8"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(emitConfig(await loadFixture("nested")));
    expect(existsSync(join(root, "keyshelf.config.ts"))).toBe(false);
  });

  it("yaml-to-typescript refuses to overwrite without --force", async () => {
    const root = await copyFixture("basic");
    const out = join(root, "keyshelf.config.ts");
    await writeFile(out, "existing", "utf-8");

    const result = spawnSync(process.execPath, [CLI, "yaml-to-typescript"], {
      cwd: root,
      encoding: "utf-8"
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("already exists");
    await expect(readFile(out, "utf-8")).resolves.toBe("existing");
  });

  it("project-name reports no-op for age-only fixtures under --dry-run", async () => {
    const root = await copyFixture("basic");
    const result = spawnSync(process.execPath, [CLI, "project-name", "--dry-run"], {
      cwd: root,
      encoding: "utf-8"
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("age: no-op");
  });

  it("fails clearly when keyshelf.yaml is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyshelf-migrate-empty-"));
    roots.push(root);

    const result = spawnSync(process.execPath, [CLI, "yaml-to-typescript"], {
      cwd: root,
      encoding: "utf-8"
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Could not find keyshelf.yaml");
  });

  async function copyFixture(name: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), `keyshelf-migrate-${name}-`));
    roots.push(root);
    await cp(fixturePath(name), root, { recursive: true });
    if (existsSync(join(fixturePath(name), ".env.keyshelf"))) {
      await copyFile(join(fixturePath(name), ".env.keyshelf"), join(root, ".env.keyshelf"));
    }
    return root;
  }
});
