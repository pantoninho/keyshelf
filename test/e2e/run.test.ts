import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { GCP_PROJECT, createGcpClient, writeGcpFixture, deleteSecrets } from "./helpers/gcp.js";
import { writeAgeFixture } from "./helpers/age.js";

const CLI = join(import.meta.dirname, "..", "..", "bin", "keyshelf.ts");
const TSX = join(import.meta.dirname, "..", "..", "node_modules", ".bin", "tsx");

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "keyshelf-e2e-"));

  await writeFile(
    join(root, "keyshelf.yaml"),
    ["keys:", "  db:", "    host: localhost", "    port: 5432"].join("\n")
  );

  await mkdir(join(root, ".keyshelf"));
  await writeFile(
    join(root, ".keyshelf", "dev.yaml"),
    ["keys:", "  db:", "    host: dev-db"].join("\n")
  );

  await writeFile(join(root, ".env.keyshelf"), ["DB_HOST=db/host", "DB_PORT=db/port"].join("\n"));

  return root;
}

describe("keyshelf run", () => {
  let root: string;

  beforeEach(async () => {
    root = await createFixture();
  });

  it("injects env vars and runs command", () => {
    const result = execFileSync(
      TSX,
      [
        CLI,
        "run",
        "--env",
        "dev",
        "--",
        "node",
        "-e",
        "console.log(JSON.stringify({host: process.env.DB_HOST, port: process.env.DB_PORT}))"
      ],
      { cwd: root, encoding: "utf-8" }
    );
    const parsed = JSON.parse(result.trim());
    expect(parsed).toEqual({ host: "dev-db", port: "5432" });
  });

  it("explicit env vars override resolved values", () => {
    const result = execFileSync(
      TSX,
      [CLI, "run", "--env", "dev", "--", "node", "-e", "console.log(process.env.DB_HOST)"],
      { cwd: root, encoding: "utf-8", env: { ...process.env, DB_HOST: "explicit-host" } }
    );
    expect(result.trim()).toBe("explicit-host");
  });

  it("forwards child exit code", () => {
    try {
      execFileSync(TSX, [CLI, "run", "--env", "dev", "--", "node", "-e", "process.exit(42)"], {
        cwd: root,
        encoding: "utf-8"
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as { status: number }).status).toBe(42);
    }
  });

  it("fails for missing environment", () => {
    try {
      execFileSync(TSX, [CLI, "run", "--env", "staging", "--", "echo", "hi"], {
        cwd: root,
        encoding: "utf-8",
        stdio: "pipe"
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as { stderr: string }).stderr).toContain("Environment file not found");
    }
  });

  it("--map reads from specified relative path", async () => {
    await mkdir(join(root, "maps"));
    await writeFile(join(root, "maps", "custom"), "MY_HOST=db/host\n");

    const result = execFileSync(
      TSX,
      [
        CLI,
        "run",
        "--env",
        "dev",
        "--map",
        "maps/custom",
        "--",
        "node",
        "-e",
        "console.log(JSON.stringify({host: process.env.MY_HOST, port: process.env.DB_PORT}))"
      ],
      { cwd: root, encoding: "utf-8" }
    );
    const parsed = JSON.parse(result.trim());
    expect(parsed).toEqual({ host: "dev-db", port: undefined });
  });

  it("--map reads from absolute path", async () => {
    const absPath = join(root, "abs-map");
    await writeFile(absPath, "ABS_HOST=db/host\n");

    const result = execFileSync(
      TSX,
      [
        CLI,
        "run",
        "--env",
        "dev",
        "--map",
        absPath,
        "--",
        "node",
        "-e",
        "console.log(process.env.ABS_HOST)"
      ],
      { cwd: root, encoding: "utf-8" }
    );
    expect(result.trim()).toBe("dev-db");
  });

  it("--map with nonexistent file fails gracefully", () => {
    try {
      execFileSync(TSX, [CLI, "run", "--env", "dev", "--map", "no-such-file", "--", "echo", "hi"], {
        cwd: root,
        encoding: "utf-8",
        stdio: "pipe"
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as { stderr: string }).stderr).toContain("App mapping file not found");
    }
  });

  it("--map works when no default .env.keyshelf exists", async () => {
    const { unlinkSync } = await import("node:fs");
    unlinkSync(join(root, ".env.keyshelf"));

    await writeFile(join(root, "alt-map"), "ALT_HOST=db/host\n");

    const result = execFileSync(
      TSX,
      [
        CLI,
        "run",
        "--env",
        "dev",
        "--map",
        "alt-map",
        "--",
        "node",
        "-e",
        "console.log(process.env.ALT_HOST)"
      ],
      { cwd: root, encoding: "utf-8" }
    );
    expect(result.trim()).toBe("dev-db");
  });
});

describe("keyshelf run (age)", () => {
  let root: string;
  const envName = "age-test";

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "keyshelf-e2e-age-run-"));
    await writeAgeFixture(root, envName);

    execFileSync(
      TSX,
      [
        CLI,
        "set",
        "--env",
        envName,
        "--provider",
        "age",
        "--value",
        "age-secret-value",
        "db/password"
      ],
      { cwd: root, encoding: "utf-8" }
    );
  });

  it("resolves age-encrypted secret and injects env vars", () => {
    const result = execFileSync(
      TSX,
      [
        CLI,
        "run",
        "--env",
        envName,
        "--",
        "node",
        "-e",
        "console.log(JSON.stringify({host: process.env.DB_HOST, password: process.env.DB_PASSWORD}))"
      ],
      { cwd: root, encoding: "utf-8" }
    );
    const parsed = JSON.parse(result.trim());
    expect(parsed).toEqual({
      host: "prod-db",
      password: "age-secret-value"
    });
  });

  it("picks up overwritten age secret value", () => {
    execFileSync(
      TSX,
      [
        CLI,
        "set",
        "--env",
        envName,
        "--provider",
        "age",
        "--value",
        "updated-age-secret",
        "db/password"
      ],
      { cwd: root, encoding: "utf-8" }
    );

    const result = execFileSync(
      TSX,
      [CLI, "run", "--env", envName, "--", "node", "-e", "console.log(process.env.DB_PASSWORD)"],
      { cwd: root, encoding: "utf-8" }
    );
    expect(result.trim()).toBe("updated-age-secret");
  });
});

describe.skipIf(!GCP_PROJECT)("keyshelf run (gcp)", { timeout: 30_000 }, () => {
  let root: string;
  const envName = `test${Date.now()}`;
  const createdSecrets: string[] = [];
  const client = GCP_PROJECT ? createGcpClient() : (undefined as never);

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "keyshelf-e2e-gcp-run-"));
    await writeGcpFixture(root, envName, GCP_PROJECT!);

    execFileSync(
      TSX,
      [
        CLI,
        "set",
        "--env",
        envName,
        "--provider",
        "gcp",
        "--value",
        "gcp-secret-value",
        "db/password"
      ],
      { cwd: root, encoding: "utf-8" }
    );
    createdSecrets.push(`projects/${GCP_PROJECT}/secrets/keyshelf__${envName}__db__password`);
  });

  afterAll(async () => {
    await deleteSecrets(client, createdSecrets);
  });

  it("resolves GCP secret and injects env vars", () => {
    const result = execFileSync(
      TSX,
      [
        CLI,
        "run",
        "--env",
        envName,
        "--",
        "node",
        "-e",
        "console.log(JSON.stringify({host: process.env.DB_HOST, password: process.env.DB_PASSWORD}))"
      ],
      { cwd: root, encoding: "utf-8" }
    );
    const parsed = JSON.parse(result.trim());
    expect(parsed).toEqual({
      host: "prod-db",
      password: "gcp-secret-value"
    });
  });

  it("picks up overwritten secret value", () => {
    execFileSync(
      TSX,
      [
        CLI,
        "set",
        "--env",
        envName,
        "--provider",
        "gcp",
        "--value",
        "updated-secret",
        "db/password"
      ],
      { cwd: root, encoding: "utf-8" }
    );

    const result = execFileSync(
      TSX,
      [CLI, "run", "--env", envName, "--", "node", "-e", "console.log(process.env.DB_PASSWORD)"],
      { cwd: root, encoding: "utf-8" }
    );
    expect(result.trim()).toBe("updated-secret");
  });
});
