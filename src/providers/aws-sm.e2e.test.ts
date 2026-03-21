import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  SecretsManagerClient,
  DeleteSecretCommand,
  GetSecretValueCommand
} from "@aws-sdk/client-secrets-manager";

const PROJECT_ROOT = resolve(__dirname, "../..");
const PROJECT_NAME = `keyshelf-e2e-test-${Date.now()}`;
const createdSecrets: string[] = [];

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "keyshelf-awssm-e2e-test-"));
  cli(["init", PROJECT_NAME]);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

afterAll(async () => {
  const client = new SecretsManagerClient({});
  await Promise.allSettled(
    createdSecrets.map((secretId) =>
      client.send(new DeleteSecretCommand({ SecretId: secretId, ForceDeleteWithoutRecovery: true }))
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
      AWS_CONFIG_FILE: join(homedir(), ".aws", "config"),
      AWS_SHARED_CREDENTIALS_FILE: join(homedir(), ".aws", "credentials")
    },
    encoding: "utf-8",
    input,
    timeout: 30000
  });
}

function secretName(keyPath: string, env = "default"): string {
  return `${PROJECT_NAME}/${env}/${keyPath}`;
}

describe.skipIf(!process.env.KEYSHELF_AWS_E2E)("keyshelf awssm e2e", { timeout: 60000 }, () => {
  it("set + get round-trip through AWS Secrets Manager", async () => {
    cli(["set", "--provider", "awssm", "api/key", "my-aws-secret"]);
    createdSecrets.push(secretName("api/key"));

    const yaml = await readFile(join(tempDir, "keyshelf.yaml"), "utf-8");
    expect(yaml).toContain("!awssm");

    const output = cli(["get", "api/key"]);
    expect(output).toBe("my-aws-secret");
  });

  it("updates an existing secret value", () => {
    cli(["set", "--provider", "awssm", "api/key", "original-value"]);
    createdSecrets.push(secretName("api/key"));

    cli(["set", "--provider", "awssm", "api/key", "updated-value"]);

    const output = cli(["get", "api/key"]);
    expect(output).toBe("updated-value");
  });

  it("stores under a specific environment", () => {
    cli(["set", "--provider", "awssm", "api/key", "staging-secret", "--env", "staging"]);
    createdSecrets.push(secretName("api/key", "staging"));

    const output = cli(["get", "api/key", "--env", "staging"]);
    expect(output).toBe("staging-secret");
  });

  it("export includes awssm-resolved values", () => {
    cli(["set", "--provider", "awssm", "api/key", "exported-secret"]);
    createdSecrets.push(secretName("api/key"));

    const output = cli(["export", "--env", "default"]);
    expect(output).toContain('API_KEY="exported-secret"');
  });

  it("run injects awssm-resolved values into subprocess", () => {
    cli(["set", "--provider", "awssm", "api/key", "injected-secret"]);
    createdSecrets.push(secretName("api/key"));

    const output = cli(["run", "--env", "default", "--", "env"]);
    expect(output).toContain("API_KEY=injected-secret");
  });

  it("rm deletes the secret from AWS Secrets Manager", async () => {
    cli(["set", "--provider", "awssm", "api/key", "doomed-secret"]);
    const name = secretName("api/key");

    cli(["rm", "api/key", "--yes"]);

    const client = new SecretsManagerClient({});
    await expect(client.send(new GetSecretValueCommand({ SecretId: name }))).rejects.toThrow();

    const yaml = await readFile(join(tempDir, "keyshelf.yaml"), "utf-8");
    expect(yaml).not.toContain("api/key");
  });
});
