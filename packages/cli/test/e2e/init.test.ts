import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { CLI, TSX } from "./helpers/cli.js";

function runInit(cwd: string): string {
  return execFileSync(TSX, [CLI, "init"], { cwd, encoding: "utf-8" });
}

describe("keyshelf init", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "keyshelf-init-"));
  });

  it("scaffolds a valid keyshelf.config.ts and an AGENTS.md keyshelf section in a fresh repo", async () => {
    runInit(root);

    const configPath = join(root, "keyshelf.config.ts");
    const agentsPath = join(root, "AGENTS.md");
    expect(existsSync(configPath)).toBe(true);
    expect(existsSync(agentsPath)).toBe(true);

    const agents = await readFile(agentsPath, "utf-8");
    expect(agents).toContain("## keyshelf");
    expect(agents).toContain("keyshelf check");
    expect(agents).toContain("keyshelf rules");
    expect(agents).toContain("docs/spec.md");

    // The scaffolded config passes validation: `keyshelf ls` loads + normalizes it.
    const ls = execFileSync(TSX, [CLI, "ls"], { cwd: root, encoding: "utf-8" });
    expect(ls).toContain("api-url");
    expect(ls).toContain("api-token");
  });

  it("refuses to overwrite an existing keyshelf.config.ts", async () => {
    const configPath = join(root, "keyshelf.config.ts");
    await writeFile(configPath, "// my hand-written config\n");

    runInit(root);

    // config untouched
    expect(await readFile(configPath, "utf-8")).toBe("// my hand-written config\n");
    // but AGENTS.md still scaffolded
    expect(existsSync(join(root, "AGENTS.md"))).toBe(true);
  });

  it("appends only the keyshelf section to an existing AGENTS.md, leaving the rest untouched", async () => {
    const agentsPath = join(root, "AGENTS.md");
    await writeFile(agentsPath, "# AGENTS.md\n\n## build\nRun `npm test`.\n");

    runInit(root);

    const agents = await readFile(agentsPath, "utf-8");
    expect(agents).toContain("## build");
    expect(agents).toContain("Run `npm test`.");
    expect(agents).toContain("## keyshelf");
    expect(agents.startsWith("# AGENTS.md\n\n## build\nRun `npm test`.\n")).toBe(true);
  });

  it("is idempotent: running twice produces identical files and no duplicate section", async () => {
    runInit(root);
    const configAfterFirst = await readFile(join(root, "keyshelf.config.ts"), "utf-8");
    const agentsAfterFirst = await readFile(join(root, "AGENTS.md"), "utf-8");

    runInit(root);
    const configAfterSecond = await readFile(join(root, "keyshelf.config.ts"), "utf-8");
    const agentsAfterSecond = await readFile(join(root, "AGENTS.md"), "utf-8");

    expect(configAfterSecond).toBe(configAfterFirst);
    expect(agentsAfterSecond).toBe(agentsAfterFirst);
    expect(agentsAfterSecond.split("## keyshelf").length - 1).toBe(1);
  });
});
