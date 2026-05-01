import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findV5RootDir, loadV5Config } from "../../src/v5/config/index.js";

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "keyshelf-v5-loader-"));
  await writeFile(
    join(root, "keyshelf.config.ts"),
    [
      'import { age, config, defineConfig, secret } from "keyshelf/config";',
      "",
      "export default defineConfig({",
      '  name: "test",',
      '  envs: ["dev", "production"],',
      '  groups: ["app", "ci"],',
      "  keys: {",
      '    log: { level: "info" },',
      '    "db/host": config({ group: "app", default: "localhost", values: { production: "prod-db" } }),',
      '    "github/token": secret({ group: "ci", value: age({ identityFile: "./ci.txt", secretsDir: "./secrets" }) })',
      "  }",
      "});"
    ].join("\n")
  );

  const appDir = join(root, "apps", "api");
  await mkdir(appDir, { recursive: true });
  await writeFile(
    join(appDir, ".env.keyshelf"),
    ["DB_HOST=db/host", "LOG_LEVEL=log/level", "GITHUB_TOKEN=github/token"].join("\n")
  );

  return { root, appDir };
}

describe("v5 config loader", () => {
  it("finds a v5 root from a nested app directory", async () => {
    const { root, appDir } = await createFixture();

    expect(findV5RootDir(appDir)).toBe(root);
  });

  it("loads TypeScript config through jiti and validates app mappings", async () => {
    const { root, appDir } = await createFixture();

    const loaded = await loadV5Config(appDir);

    expect(loaded.rootDir).toBe(root);
    expect(loaded.configPath).toBe(join(root, "keyshelf.config.ts"));
    expect(loaded.config.envs).toEqual(["dev", "production"]);
    expect(loaded.config.groups).toEqual(["app", "ci"]);
    expect(loaded.config.keys.map((key) => key.path)).toEqual([
      "log/level",
      "db/host",
      "github/token"
    ]);
    expect(loaded.appMapping).toEqual([
      { envVar: "DB_HOST", keyPath: "db/host" },
      { envVar: "LOG_LEVEL", keyPath: "log/level" },
      { envVar: "GITHUB_TOKEN", keyPath: "github/token" }
    ]);
    expect(loaded.loadTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("rejects unknown .env.keyshelf references at load time", async () => {
    const { appDir } = await createFixture();
    await writeFile(join(appDir, ".env.keyshelf"), "DB_PASSWORD=db/password\n");

    await expect(loadV5Config(appDir)).rejects.toThrow(
      'DB_PASSWORD: references unknown key "db/password"'
    );
  });

  it("loads an explicit mapping file and rejects a missing explicit mapping file", async () => {
    const { root, appDir } = await createFixture();
    const mappingFile = join(root, "app.env.keyshelf");
    await writeFile(mappingFile, "HOST=db/host\n");

    await expect(loadV5Config(appDir, { mappingFile })).resolves.toMatchObject({
      appMapping: [{ envVar: "HOST", keyPath: "db/host" }]
    });

    await expect(loadV5Config(appDir, { mappingFile: join(root, "missing") })).rejects.toThrow(
      "App mapping file not found"
    );
  });
});
