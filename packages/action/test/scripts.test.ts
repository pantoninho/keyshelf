import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir, readFile, unlink, stat } from "node:fs/promises";
import { spawnSync, execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { generateIdentity, identityToRecipient } from "keyshelf";

const require = createRequire(import.meta.url);
const KEYSHELF_BIN = require.resolve("keyshelf/bin");
const KEYSHELF_BIN_NEXT = require.resolve("keyshelf/bin-next");
const ACTION_DIR = join(import.meta.dirname, "..");
const WRITE_IDENTITY = join(ACTION_DIR, "scripts", "write-identity.mjs");
const EMIT_ENV = join(ACTION_DIR, "scripts", "emit-env.mjs");
const WRITE_IDENTITY_V5 = join(ACTION_DIR, "scripts", "write-identity-v5.mjs");
const EMIT_ENV_V5 = join(ACTION_DIR, "scripts", "emit-env-v5.mjs");

async function setupAgeFixture(): Promise<{ root: string; identity: string }> {
  const root = await mkdtemp(join(tmpdir(), "keyshelf-action-test-"));
  const identity = await generateIdentity();
  const recipient = await identityToRecipient(identity);

  await writeFile(
    join(root, "keyshelf.yaml"),
    [
      "keys:",
      "  db:",
      "    host: localhost",
      '    password: !secret ""',
      "  service:",
      "    name: api"
    ].join("\n")
  );

  await mkdir(join(root, ".keyshelf"));
  await writeFile(
    join(root, ".keyshelf", "test.yaml"),
    [
      "default-provider:",
      "  name: age",
      "  identityFile: ./keys/age.txt",
      "  secretsDir: ./.keyshelf/secrets/test",
      `  recipients:`,
      `    - ${recipient}`
    ].join("\n")
  );

  await writeFile(
    join(root, ".env.keyshelf"),
    [
      "DB_HOST=db/host",
      "DB_PASSWORD=db/password",
      "DB_URL=postgres://${db/host}:${db/password}@srv/db",
      "SERVICE_NAME=service/name"
    ].join("\n")
  );

  await mkdir(join(root, "keys"));
  await writeFile(join(root, "keys/age.txt"), identity);

  execFileSync(
    process.execPath,
    [KEYSHELF_BIN, "set", "--env", "test", "--value", "hunter2", "db/password"],
    { cwd: root, encoding: "utf-8" }
  );

  await unlink(join(root, "keys/age.txt"));

  return { root, identity };
}

describe("write-identity.mjs", () => {
  it("writes the identity to the path declared by the env's provider with mode 0600", async () => {
    const { root, identity } = await setupAgeFixture();

    const res = spawnSync(process.execPath, [WRITE_IDENTITY], {
      cwd: root,
      env: {
        ...process.env,
        KEYSHELF_ENV: "test",
        KEYSHELF_IDENTITY: identity,
        KEYSHELF_CWD: root
      },
      encoding: "utf-8"
    });

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Wrote identity to");
    expect(res.stdout).toContain("keys/age.txt");

    const target = join(root, "keys/age.txt");
    expect((await readFile(target, "utf-8")).trim()).toBe(identity.trim());
    expect((await stat(target)).mode & 0o777).toBe(0o600);
  });

  it("warns and skips when provider has no identityFile (gcp)", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyshelf-action-noid-"));
    await writeFile(
      join(root, "keyshelf.yaml"),
      ["keys:", "  db:", "    host: localhost"].join("\n")
    );
    await mkdir(join(root, ".keyshelf"));
    await writeFile(
      join(root, ".keyshelf", "test.yaml"),
      ["default-provider:", "  name: gcp", "  project: example"].join("\n")
    );

    const res = spawnSync(process.execPath, [WRITE_IDENTITY], {
      cwd: root,
      env: {
        ...process.env,
        KEYSHELF_ENV: "test",
        KEYSHELF_IDENTITY: "fake",
        KEYSHELF_CWD: root
      },
      encoding: "utf-8"
    });

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("::warning::");
    expect(res.stdout).toContain("does not declare an identityFile");
  });

  it("is a no-op when no identity is provided", async () => {
    const { root } = await setupAgeFixture();
    const res = spawnSync(process.execPath, [WRITE_IDENTITY], {
      cwd: root,
      env: { ...process.env, KEYSHELF_ENV: "test", KEYSHELF_CWD: root },
      encoding: "utf-8"
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("No identity provided");
  });
});

async function setupV5AgeFixture(): Promise<{ root: string; identity: string }> {
  const root = await mkdtemp(join(tmpdir(), "keyshelf-action-v5-"));
  const identity = await generateIdentity();

  await writeFile(
    join(root, "keyshelf.config.ts"),
    [
      'import { config, defineConfig, secret, age } from "keyshelf/config";',
      "",
      "export default defineConfig({",
      '  name: "v5action",',
      '  envs: ["test"],',
      "  keys: {",
      "    db: {",
      '      host: "localhost",',
      "      password: secret({",
      '        value: age({ identityFile: "./keys/age.txt", secretsDir: "./.keyshelf/secrets" })',
      "      })",
      "    },",
      "    service: {",
      '      name: "api"',
      "    }",
      "  }",
      "});"
    ].join("\n")
  );

  await writeFile(
    join(root, ".env.keyshelf"),
    [
      "DB_HOST=db/host",
      "DB_PASSWORD=db/password",
      "DB_URL=postgres://${db/host}:${db/password}@srv/db",
      "SERVICE_NAME=service/name"
    ].join("\n")
  );

  await mkdir(join(root, "keys"));
  await writeFile(join(root, "keys/age.txt"), identity);

  execFileSync(
    process.execPath,
    [KEYSHELF_BIN_NEXT, "set", "--env", "test", "--value", "hunter2", "db/password"],
    { cwd: root, encoding: "utf-8" }
  );

  await unlink(join(root, "keys/age.txt"));
  return { root, identity };
}

describe("write-identity-v5.mjs", () => {
  it("writes identity to every unique age identityFile path declared in the v5 config", async () => {
    const { root, identity } = await setupV5AgeFixture();

    const res = spawnSync(process.execPath, [WRITE_IDENTITY_V5], {
      cwd: root,
      env: { ...process.env, KEYSHELF_IDENTITY: identity, KEYSHELF_CWD: root },
      encoding: "utf-8"
    });

    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain("Wrote identity to");
    expect(res.stdout).toContain("keys/age.txt");

    const target = join(root, "keys/age.txt");
    expect((await readFile(target, "utf-8")).trim()).toBe(identity.trim());
    expect((await stat(target)).mode & 0o777).toBe(0o600);
  });

  it("warns and skips when the v5 config declares no age providers", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyshelf-action-v5-noage-"));
    await writeFile(
      join(root, "keyshelf.config.ts"),
      [
        'import { defineConfig } from "keyshelf/config";',
        "",
        "export default defineConfig({",
        '  name: "noage",',
        '  envs: ["test"],',
        '  keys: { db: { host: "localhost" } }',
        "});"
      ].join("\n")
    );

    const res = spawnSync(process.execPath, [WRITE_IDENTITY_V5], {
      cwd: root,
      env: { ...process.env, KEYSHELF_IDENTITY: "fake", KEYSHELF_CWD: root },
      encoding: "utf-8"
    });

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("::warning::");
    expect(res.stdout).toContain("declares no age providers");
  });

  it("is a no-op when no identity is provided", async () => {
    const { root } = await setupV5AgeFixture();
    const res = spawnSync(process.execPath, [WRITE_IDENTITY_V5], {
      cwd: root,
      env: { ...process.env, KEYSHELF_CWD: root },
      encoding: "utf-8"
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("No identity provided");
  });
});

describe("emit-env-v5.mjs", () => {
  it("masks v5 secrets, resolves templates, and emits to GITHUB_ENV via heredoc", async () => {
    const { root, identity } = await setupV5AgeFixture();
    await writeFile(join(root, "keys/age.txt"), identity, { mode: 0o600 });

    const githubEnvPath = join(root, "github-env");
    await writeFile(githubEnvPath, "");

    const res = spawnSync(process.execPath, [EMIT_ENV_V5], {
      cwd: root,
      env: {
        ...process.env,
        KEYSHELF_ENV: "test",
        KEYSHELF_MAPS: ".env.keyshelf",
        KEYSHELF_CWD: root,
        GITHUB_ENV: githubEnvPath
      },
      encoding: "utf-8"
    });

    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain("::add-mask::hunter2");
    expect(res.stdout).toContain("::add-mask::postgres://localhost:hunter2@srv/db");
    expect(res.stdout).not.toContain("::add-mask::api");

    const env = await readFile(githubEnvPath, "utf-8");
    expect(env).toMatch(/DB_HOST<<EOF_[a-f0-9]+\nlocalhost\nEOF_/);
    expect(env).toMatch(/DB_PASSWORD<<EOF_[a-f0-9]+\nhunter2\nEOF_/);
    expect(env).toMatch(/DB_URL<<EOF_[a-f0-9]+\npostgres:\/\/localhost:hunter2@srv\/db\nEOF_/);
    expect(env).toMatch(/SERVICE_NAME<<EOF_[a-f0-9]+\napi\nEOF_/);
  });

  it("emits a stderr skip warning when --groups filters out a referenced key", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyshelf-action-v5-grp-"));
    await writeFile(
      join(root, "keyshelf.config.ts"),
      [
        'import { config, defineConfig } from "keyshelf/config";',
        "",
        "export default defineConfig({",
        '  name: "v5grp",',
        '  envs: ["test"],',
        '  groups: ["app", "ci"],',
        "  keys: {",
        '    app: { host: config({ group: "app", value: "localhost" }) },',
        '    ci: { token: config({ group: "ci", value: "ci-token" }) }',
        "  }",
        "});"
      ].join("\n")
    );
    await writeFile(
      join(root, ".env.keyshelf"),
      ["APP_HOST=app/host", "CI_TOKEN=ci/token"].join("\n")
    );

    const githubEnvPath = join(root, "github-env");
    await writeFile(githubEnvPath, "");

    const res = spawnSync(process.execPath, [EMIT_ENV_V5], {
      cwd: root,
      env: {
        ...process.env,
        KEYSHELF_MAPS: ".env.keyshelf",
        KEYSHELF_GROUPS: "app",
        KEYSHELF_CWD: root,
        GITHUB_ENV: githubEnvPath
      },
      encoding: "utf-8"
    });

    expect(res.status, res.stderr).toBe(0);
    expect(res.stderr).toContain(
      "keyshelf: skipping CI_TOKEN — referenced key 'ci/token' is filtered out by --group=app"
    );
    const env = await readFile(githubEnvPath, "utf-8");
    expect(env).toMatch(/APP_HOST<<EOF_[a-f0-9]+\nlocalhost\nEOF_/);
    expect(env).not.toContain("CI_TOKEN");
  });

  it("fails when neither GITHUB_ENV nor map are set", async () => {
    const { root } = await setupV5AgeFixture();
    const res = spawnSync(process.execPath, [EMIT_ENV_V5], {
      cwd: root,
      env: { ...process.env, KEYSHELF_MAPS: ".env.keyshelf", KEYSHELF_CWD: root, GITHUB_ENV: "" },
      encoding: "utf-8"
    });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("GITHUB_ENV is not set");
  });
});

describe("emit-env.mjs", () => {
  it("masks secret values and appends all vars to GITHUB_ENV using heredocs", async () => {
    const { root, identity } = await setupAgeFixture();
    await writeFile(join(root, "keys/age.txt"), identity, { mode: 0o600 });

    const githubEnvPath = join(root, "github-env");
    await writeFile(githubEnvPath, "");

    const res = spawnSync(process.execPath, [EMIT_ENV], {
      cwd: root,
      env: {
        ...process.env,
        KEYSHELF_ENV: "test",
        KEYSHELF_MAPS: ".env.keyshelf",
        KEYSHELF_CWD: root,
        GITHUB_ENV: githubEnvPath
      },
      encoding: "utf-8"
    });

    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain("::add-mask::hunter2");
    expect(res.stdout).toContain("::add-mask::postgres://localhost:hunter2@srv/db");
    expect(res.stdout).not.toContain("::add-mask::api");
    expect(res.stdout).not.toContain("::add-mask::localhost\n");

    const env = await readFile(githubEnvPath, "utf-8");
    expect(env).toMatch(/DB_HOST<<EOF_[a-f0-9]+\nlocalhost\nEOF_/);
    expect(env).toMatch(/DB_PASSWORD<<EOF_[a-f0-9]+\nhunter2\nEOF_/);
    expect(env).toMatch(/DB_URL<<EOF_[a-f0-9]+\npostgres:\/\/localhost:hunter2@srv\/db\nEOF_/);
    expect(env).toMatch(/SERVICE_NAME<<EOF_[a-f0-9]+\napi\nEOF_/);
  });

  it("fails when GITHUB_ENV is unset", async () => {
    const { root } = await setupAgeFixture();
    const res = spawnSync(process.execPath, [EMIT_ENV], {
      cwd: root,
      env: {
        ...process.env,
        KEYSHELF_ENV: "test",
        KEYSHELF_MAPS: ".env.keyshelf",
        KEYSHELF_CWD: root,
        GITHUB_ENV: ""
      },
      encoding: "utf-8"
    });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("GITHUB_ENV is not set");
  });

  it("fails when map input is empty", async () => {
    const { root } = await setupAgeFixture();
    const githubEnvPath = join(root, "github-env");
    await writeFile(githubEnvPath, "");

    const res = spawnSync(process.execPath, [EMIT_ENV], {
      cwd: root,
      env: {
        ...process.env,
        KEYSHELF_ENV: "test",
        KEYSHELF_MAPS: "",
        KEYSHELF_CWD: root,
        GITHUB_ENV: githubEnvPath
      },
      encoding: "utf-8"
    });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("'map' input is empty");
  });
});
