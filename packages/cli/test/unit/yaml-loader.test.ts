import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadYamlConfig } from "../../src/config/yaml-loader.js";
import { normalizeConfig } from "../../src/config/schema.js";

async function writeProject(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "yaml-loader-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content);
  }
  return root;
}

describe("yaml-loader", () => {
  it("collapses identical per-env values into a default", async () => {
    const root = await writeProject({
      "keyshelf.yaml": ["name: app", "keys:", "  log:", "    level: info"].join("\n"),
      ".keyshelf/dev.yaml": "",
      ".keyshelf/production.yaml": ""
    });

    const config = normalizeConfig(await loadYamlConfig(join(root, "keyshelf.yaml")));
    expect(config.keys).toContainEqual(
      expect.objectContaining({ path: "log/level", kind: "config", value: "info" })
    );
  });

  it("emits per-env values when overrides differ", async () => {
    const root = await writeProject({
      "keyshelf.yaml": ["name: app", "keys:", "  db:", "    host: localhost"].join("\n"),
      ".keyshelf/dev.yaml": ["keys:", "  db:", "    host: dev-db"].join("\n"),
      ".keyshelf/production.yaml": ["keys:", "  db:", "    host: prod-db"].join("\n")
    });

    const config = normalizeConfig(await loadYamlConfig(join(root, "keyshelf.yaml")));
    const dbHost = config.keys.find((k) => k.path === "db/host");
    expect(dbHost).toMatchObject({
      kind: "config",
      values: { dev: "dev-db", production: "prod-db" }
    });
  });

  it("merges per-env tag options over env-level default-provider options", async () => {
    const root = await writeProject({
      "keyshelf.yaml": ["name: app", "keys:", "  api:", "    token: !secret"].join("\n"),
      ".keyshelf/dev.yaml": [
        "default-provider:",
        "  name: age",
        "  identityFile: ./dev.txt",
        "  secretsDir: ./dev-secrets",
        "keys:",
        "  api:",
        "    token: !age",
        "      secretsDir: ./override-secrets"
      ].join("\n")
    });

    const config = normalizeConfig(await loadYamlConfig(join(root, "keyshelf.yaml")));
    const token = config.keys.find((k) => k.path === "api/token");
    expect(token).toMatchObject({
      kind: "secret",
      values: {
        dev: {
          __kind: "provider:age",
          options: { identityFile: "./dev.txt", secretsDir: "./override-secrets" }
        }
      }
    });
  });

  it("rejects a provider tag on a non-secret key", async () => {
    const root = await writeProject({
      "keyshelf.yaml": ["name: app", "keys:", "  db:", "    host: localhost"].join("\n"),
      ".keyshelf/dev.yaml": [
        "keys:",
        "  db:",
        "    host: !age",
        "      identityFile: ./x",
        "      secretsDir: ./y"
      ].join("\n")
    });

    await expect(loadYamlConfig(join(root, "keyshelf.yaml"))).rejects.toThrow(
      /provider tag on a config key/
    );
  });

  it("rejects a plaintext value on a !secret key", async () => {
    const root = await writeProject({
      "keyshelf.yaml": ["name: app", "keys:", "  api:", "    token: !secret"].join("\n"),
      ".keyshelf/dev.yaml": ["keys:", "  api:", "    token: just-a-string"].join("\n")
    });

    await expect(loadYamlConfig(join(root, "keyshelf.yaml"))).rejects.toThrow(
      /secret keys require a provider tag/
    );
  });

  it("requires a top-level name", async () => {
    const root = await writeProject({
      "keyshelf.yaml": "keys: { foo: bar }\n",
      ".keyshelf/dev.yaml": ""
    });

    await expect(loadYamlConfig(join(root, "keyshelf.yaml"))).rejects.toThrow(/name/);
  });
});
