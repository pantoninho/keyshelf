import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const PROJECT_ROOT = resolve(__dirname, "../..");

let tempDir: string;
let pulumiDir: string;
let keyshelfDir: string;

function cli(args: string[]): string {
  const tsconfig = join(PROJECT_ROOT, "tsconfig.json");
  const entry = join(PROJECT_ROOT, "src/index.ts");
  return execFileSync("npx", ["tsx", "--tsconfig", tsconfig, entry, ...args], {
    cwd: keyshelfDir,
    env: {
      ...process.env,
      HOME: tempDir,
      PULUMI_CONFIG_PASSPHRASE: "",
      PULUMI_BACKEND_URL: `file://${pulumiDir}/.pulumi-state`
    },
    encoding: "utf-8",
    timeout: 30000
  });
}

function pulumi(args: string[]): string {
  return execFileSync("pulumi", args, {
    cwd: pulumiDir,
    env: {
      ...process.env,
      PULUMI_CONFIG_PASSPHRASE: "",
      PULUMI_BACKEND_URL: `file://${pulumiDir}/.pulumi-state`
    },
    encoding: "utf-8",
    timeout: 30000
  });
}

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "keyshelf-pulumi-e2e-"));
  pulumiDir = join(tempDir, "infra");
  keyshelfDir = join(tempDir, "app");
  await mkdir(pulumiDir, { recursive: true });
  await mkdir(join(pulumiDir, ".pulumi-state"), { recursive: true });
  await mkdir(keyshelfDir, { recursive: true });

  // Create a minimal Pulumi YAML project with known outputs
  await writeFile(
    join(pulumiDir, "Pulumi.yaml"),
    [
      "name: keyshelf-pulumi-e2e",
      "runtime: yaml",
      "outputs:",
      '  dbUrl: "postgres://localhost/testdb"',
      "  secretValue:",
      '    fn::secret: "super-secret-value"'
    ].join("\n")
  );

  // Initialize stack and deploy (no real infra — YAML runtime with static outputs)
  pulumi(["stack", "init", "test"]);
  pulumi(["up", "--yes"]);

  // Create keyshelf.yaml with pulumi provider pointing to the infra dir
  await writeFile(
    join(keyshelfDir, "keyshelf.yaml"),
    [
      "project: pulumi-e2e-test",
      "pulumi:",
      `  cwd: ${pulumiDir}`,
      "keys:",
      "  database/url:",
      "    default: !pulumi test.dbUrl",
      "  api/secret:",
      "    default: !pulumi test.secretValue"
    ].join("\n")
  );
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe.skipIf(!process.env.KEYSHELF_PULUMI_E2E)("keyshelf pulumi e2e", { timeout: 60000 }, () => {
  it("resolves a pulumi stack output via get", () => {
    const output = cli(["get", "database/url"]);
    expect(output).toBe("postgres://localhost/testdb");
  });

  it("resolves a secret pulumi output via get", () => {
    const output = cli(["get", "api/secret"]);
    expect(output).toBe("super-secret-value");
  });

  it("export includes pulumi-resolved values", () => {
    const output = cli(["export", "--env", "default"]);
    expect(output).toContain('DATABASE_URL="postgres://localhost/testdb"');
    expect(output).toContain('API_SECRET="super-secret-value"');
  });

  it("run injects pulumi-resolved values into subprocess", () => {
    const output = cli(["run", "--env", "default", "--", "env"]);
    expect(output).toContain("DATABASE_URL=postgres://localhost/testdb");
    expect(output).toContain("API_SECRET=super-secret-value");
  });
});
