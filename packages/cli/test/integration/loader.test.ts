import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { findRootDir, loadConfig } from "../../src/config/index.js";

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "keyshelf-loader-"));
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

describe("config loader", () => {
  it("finds a root from a nested app directory", async () => {
    const { root, appDir } = await createFixture();

    expect(findRootDir(appDir)).toBe(root);
  });

  it("loads TypeScript config through jiti and validates app mappings", async () => {
    const { root, appDir } = await createFixture();

    const loaded = await loadConfig(appDir);

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

    await expect(loadConfig(appDir)).rejects.toThrow(
      'DB_PASSWORD: references unknown key "db/password"'
    );
  });

  describe("KEYSHELF_CONFIG_MODULE_PATH override", () => {
    afterEach(() => {
      delete process.env.KEYSHELF_CONFIG_MODULE_PATH;
      vi.resetModules();
    });

    it("routes the keyshelf/config alias to the path in the env var", async () => {
      const { appDir } = await createFixture();

      // Sentinel module that re-exports the real factories: if the alias
      // routes through this file, the loader still resolves; if the env var
      // is ignored we have no easy way to detect it, so prove routing by
      // pointing at a missing path and asserting the failure message names
      // it. That confirms the alias is honoring the env var.
      process.env.KEYSHELF_CONFIG_MODULE_PATH = "/does/not/exist/keyshelf-config.mjs";
      vi.resetModules();
      const mod = await import("../../src/config/loader.js");

      await expect(mod.loadConfig(appDir)).rejects.toThrow(
        /does[\\/]not[\\/]exist[\\/]keyshelf-config\.mjs|Cannot find module/
      );
    });

    it("resolves a relative override path against process.cwd()", async () => {
      const { appDir } = await createFixture();

      process.env.KEYSHELF_CONFIG_MODULE_PATH = "relative/missing/keyshelf-config.mjs";
      vi.resetModules();
      const mod = await import("../../src/config/loader.js");

      const expectedAbs = resolve("relative/missing/keyshelf-config.mjs");
      await expect(mod.loadConfig(appDir)).rejects.toThrow(
        new RegExp(expectedAbs.replace(/[\\/]/g, "[\\\\/]"))
      );
    });
  });

  describe("yaml config", () => {
    it("loads keyshelf.yaml when no .config.ts is present", async () => {
      const root = await mkdtemp(join(tmpdir(), "keyshelf-yaml-load-"));
      await writeFile(
        join(root, "keyshelf.yaml"),
        [
          "name: yaml-app",
          "keys:",
          "  log:",
          "    level: info",
          "  db:",
          "    host: localhost"
        ].join("\n")
      );
      await mkdir(join(root, ".keyshelf"), { recursive: true });
      await writeFile(
        join(root, ".keyshelf", "dev.yaml"),
        ["keys:", "  db:", "    host: dev-db"].join("\n")
      );
      await writeFile(
        join(root, ".keyshelf", "production.yaml"),
        ["keys:", "  db:", "    host: prod-db"].join("\n")
      );

      const appDir = join(root, "apps", "api");
      await mkdir(appDir, { recursive: true });
      await writeFile(appDir + "/.env.keyshelf", "DB_HOST=db/host\nLOG_LEVEL=log/level\n");

      const loaded = await loadConfig(appDir);
      expect(loaded.rootDir).toBe(root);
      expect(loaded.configPath).toBe(join(root, "keyshelf.yaml"));
      expect(loaded.config.name).toBe("yaml-app");
      expect(loaded.config.envs).toEqual(["dev", "production"]);
      const dbHost = loaded.config.keys.find((k) => k.path === "db/host");
      expect(dbHost).toMatchObject({
        kind: "config",
        values: { dev: "dev-db", production: "prod-db" }
      });
    });

    it("prefers keyshelf.config.ts when both files exist", async () => {
      const { root, appDir } = await createFixture();
      await writeFile(join(root, "keyshelf.yaml"), "name: legacy\nkeys: {}\n");

      const loaded = await loadConfig(appDir);
      expect(loaded.configPath).toBe(join(root, "keyshelf.config.ts"));
    });

    it("resolves !secret tags through env-level default-provider", async () => {
      const root = await mkdtemp(join(tmpdir(), "keyshelf-yaml-secret-"));
      await writeFile(
        join(root, "keyshelf.yaml"),
        ["name: secrets-app", "keys:", "  github:", "    token: !secret"].join("\n")
      );
      await mkdir(join(root, ".keyshelf"), { recursive: true });
      await writeFile(
        join(root, ".keyshelf", "dev.yaml"),
        [
          "default-provider:",
          "  name: age",
          "  identityFile: ./dev.txt",
          "  secretsDir: ./dev-secrets"
        ].join("\n")
      );

      await writeFile(join(root, ".env.keyshelf"), "GH=github/token\n");
      const loaded = await loadConfig(root);
      const tokenKey = loaded.config.keys.find((k) => k.path === "github/token");
      expect(tokenKey).toMatchObject({
        kind: "secret",
        values: {
          dev: {
            __kind: "provider:age",
            name: "age",
            options: { identityFile: "./dev.txt", secretsDir: "./dev-secrets" }
          }
        }
      });
    });
  });

  it("loads an explicit mapping file and rejects a missing explicit mapping file", async () => {
    const { root, appDir } = await createFixture();
    const mappingFile = join(root, "app.env.keyshelf");
    await writeFile(mappingFile, "HOST=db/host\n");

    await expect(loadConfig(appDir, { mappingFile })).resolves.toMatchObject({
      appMapping: [{ envVar: "HOST", keyPath: "db/host" }]
    });

    await expect(loadConfig(appDir, { mappingFile: join(root, "missing") })).rejects.toThrow(
      "App mapping file not found"
    );
  });
});
