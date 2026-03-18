import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

const PROJECT_ROOT = resolve(__dirname, "../..");
const GCP_PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? "keyshelf-e2e-test";
const PROJECT_NAME = `keyshelf-e2e-test-${Date.now()}`;
const createdSecrets: string[] = [];

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "keyshelf-gcpsm-e2e-test-"));
  cli(["init", PROJECT_NAME]);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

afterAll(async () => {
  const client = new SecretManagerServiceClient();
  await Promise.allSettled(
    createdSecrets.map((secretName) =>
      client.deleteSecret({ name: `projects/${GCP_PROJECT}/secrets/${secretName}` })
    )
  );
});

function cli(args: string[], input?: string): string {
  const tsconfig = join(PROJECT_ROOT, "tsconfig.json");
  const entry = join(PROJECT_ROOT, "src/index.ts");
  return execFileSync("npx", ["tsx", "--tsconfig", tsconfig, entry, ...args], {
    cwd: tempDir,
    env: {
      ...process.env,
      HOME: tempDir,
      GOOGLE_CLOUD_PROJECT: GCP_PROJECT,
      GOOGLE_APPLICATION_CREDENTIALS: join(
        homedir(),
        ".config",
        "gcloud",
        "application_default_credentials.json"
      )
    },
    encoding: "utf-8",
    input,
    timeout: 30000
  });
}

function secretId(keyPath: string, env = "default"): string {
  const sanitizedKeyPath = keyPath.replace(/\//g, "__");
  return `${PROJECT_NAME}__${env}__${sanitizedKeyPath}`;
}

describe.skipIf(!process.env.KEYSHELF_GCP_E2E)("keyshelf gcsm e2e", { timeout: 60000 }, () => {
  it("set + get round-trip through GCP Secret Manager", async () => {
    cli(["set", "--provider", "gcsm", "api/key", "my-gcp-secret"]);
    createdSecrets.push(secretId("api/key"));

    const yaml = await readFile(join(tempDir, "keyshelf.yaml"), "utf-8");
    expect(yaml).toContain("!gcsm");

    const output = cli(["get", "api/key"]);
    expect(output).toBe("my-gcp-secret");
  });

  it("updates an existing secret value", () => {
    cli(["set", "--provider", "gcsm", "api/key", "original-value"]);
    createdSecrets.push(secretId("api/key"));

    cli(["set", "--provider", "gcsm", "api/key", "updated-value"]);

    const output = cli(["get", "api/key"]);
    expect(output).toBe("updated-value");
  });

  it("stores under a specific environment", () => {
    cli(["set", "--provider", "gcsm", "api/key", "staging-secret", "--env", "staging"]);
    createdSecrets.push(secretId("api/key", "staging"));

    const output = cli(["get", "api/key", "--env", "staging"]);
    expect(output).toBe("staging-secret");
  });

  it("export includes gcsm-resolved values", () => {
    cli(["set", "--provider", "gcsm", "api/key", "exported-secret"]);
    createdSecrets.push(secretId("api/key"));

    const output = cli(["export", "--env", "default"]);
    expect(output).toContain('API_KEY="exported-secret"');
  });

  it("run injects gcsm-resolved values into subprocess", () => {
    cli(["set", "--provider", "gcsm", "api/key", "injected-secret"]);
    createdSecrets.push(secretId("api/key"));

    const output = cli(["run", "--env", "default", "--", "env"]);
    expect(output).toContain("API_KEY=injected-secret");
  });
});
