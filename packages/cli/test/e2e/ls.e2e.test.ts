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

/** Scaffold the issue's worked example: backend (5 keys) + mobile (2 keys). */
async function scaffold(): Promise<void> {
  await write(".keyshelf/config.yaml", CONFIG);
  await write(
    ".keyshelf/backend/schema.yaml",
    "keys:\n  A: !required\n  B: !required\n  C: !optional\n  D: x\n  E: y\n"
  );
  await write(".keyshelf/backend/dev.yaml", "provider: local\nkeys: {}\n");
  await write(".keyshelf/backend/production.yaml", "provider: local\nkeys: {}\n");
  await write(".keyshelf/mobile/schema.yaml", "keys:\n  X: !required\n  Y: !optional\n");
  await write(".keyshelf/mobile/production.yaml", "provider: local\nkeys: {}\n");
}

// eslint-disable-next-line no-control-regex
const ANSI = /\[/;

describe("keyshelf ls (project map)", () => {
  it("prints the shelf/environment tree with each shelf's contract size", async () => {
    await scaffold();
    const { code, stdout } = await runKeyshelf(["ls"], { cwd });
    expect(code).toBe(0);
    expect(stdout).toBe(
      ["backend (5 keys)", "├─ dev", "└─ production", "mobile (2 keys)", "└─ production", ""].join(
        "\n"
      )
    );
  });

  it("works under the `list` alias", async () => {
    await scaffold();
    const { code, stdout } = await runKeyshelf(["list"], { cwd });
    expect(code).toBe(0);
    expect(stdout).toContain("backend (5 keys)");
    expect(stdout).toContain("mobile (2 keys)");
  });

  it("returns the environment-centric --json shape", async () => {
    await scaffold();
    const { code, stdout } = await runKeyshelf(["ls", "--json"], { cwd });
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      environments: [
        { shelf: "backend", stage: "dev", keys: 5 },
        { shelf: "backend", stage: "production", keys: 5 },
        { shelf: "mobile", stage: "production", keys: 2 }
      ]
    });
  });

  it("sorts shelves and environment leaves alphabetically", async () => {
    await write(".keyshelf/config.yaml", CONFIG);
    await write(".keyshelf/zoo/schema.yaml", "keys:\n  K: !required\n");
    await write(".keyshelf/zoo/beta.yaml", "provider: local\nkeys: {}\n");
    await write(".keyshelf/zoo/alpha.yaml", "provider: local\nkeys: {}\n");
    await write(".keyshelf/apple/schema.yaml", "keys:\n  K: !required\n");
    await write(".keyshelf/apple/prod.yaml", "provider: local\nkeys: {}\n");

    const { stdout } = await runKeyshelf(["ls"], { cwd });
    const lines = stdout.trimEnd().split("\n");
    expect(lines).toEqual([
      "apple (1 keys)",
      "└─ prod",
      "zoo (1 keys)",
      "├─ alpha",
      "└─ beta"
    ]);
  });

  it("renders a shelf with no environments as a node with no leaves", async () => {
    await write(".keyshelf/config.yaml", CONFIG);
    await write(".keyshelf/lonely/schema.yaml", "keys:\n  K: !required\n");

    const { code, stdout } = await runKeyshelf(["ls"], { cwd });
    expect(code).toBe(0);
    expect(stdout.trimEnd().split("\n")).toEqual(["lonely (1 keys)"]);

    const json = await runKeyshelf(["ls", "--json"], { cwd });
    expect(JSON.parse(json.stdout)).toEqual({ environments: [] });
  });

  it("prints a friendly one-liner and exits 0 for an empty project", async () => {
    await write(".keyshelf/config.yaml", CONFIG);
    const { code, stdout } = await runKeyshelf(["ls"], { cwd });
    expect(code).toBe(0);
    expect(stdout).toContain("No shelves yet. Add one under .keyshelf/.");
  });

  it("emits an empty environments array for an empty project under --json", async () => {
    await write(".keyshelf/config.yaml", CONFIG);
    const { code, stdout } = await runKeyshelf(["ls", "--json"], { cwd });
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ environments: [] });
  });

  it("surfaces NOT_INITIALIZED for an uninitialised project", async () => {
    const { code, stdout, stderr } = await runKeyshelf(["ls", "--json"], { cwd });
    expect(code).not.toBe(0);
    expect(JSON.parse(stdout).error.code).toBe("NOT_INITIALIZED");
    expect(stderr).toBe("");
  });

  it("fails fast with the broken shelf's KeyshelfError (no partial render)", async () => {
    await scaffold();
    // A shelf directory with no schema.yaml — SCHEMA_NOT_FOUND, aborts the map.
    await write(".keyshelf/broken/dev.yaml", "provider: local\nkeys: {}\n");
    const { code, stdout } = await runKeyshelf(["ls", "--json"], { cwd });
    expect(code).not.toBe(0);
    expect(JSON.parse(stdout).error).toMatchObject({ code: "SCHEMA_NOT_FOUND", shelf: "broken" });
  });

  it("disables colour on a non-TTY (no ANSI escapes in piped output)", async () => {
    await scaffold();
    const { stdout } = await runKeyshelf(["ls"], { cwd });
    expect(ANSI.test(stdout)).toBe(false);
  });

  it("disables colour when NO_COLOR is set", async () => {
    await scaffold();
    const { stdout } = await runKeyshelf(["ls"], { cwd, env: { NO_COLOR: "1", FORCE_COLOR: "1" } });
    expect(ANSI.test(stdout)).toBe(false);
  });

  it("exposes --help and exits zero", async () => {
    const { code, stdout } = await runKeyshelf(["ls", "--help"], { cwd });
    expect(code).toBe(0);
    expect(stdout).toContain("ls");
  });
});
