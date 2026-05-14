import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { age, config, defineConfig, plain, secret, gcp } from "../../src/config/index.js";
import { normalizeConfig } from "../../src/config/index.js";
import { loadYamlConfig } from "../../src/config/yaml-loader.js";
import { resolve as resolveResult } from "../../src/resolver/index.js";
import { ProviderRegistry } from "../../src/providers/registry.js";
import { AgeProvider, generateIdentity } from "../../src/providers/age.js";
import { GcpSmProvider } from "../../src/providers/gcp-sm.js";
import { PlaintextProvider } from "../../src/providers/plaintext.js";

async function ageFixture() {
  const dir = await mkdtemp(join(tmpdir(), "keyshelf-age-"));
  const identityFile = join(dir, "id.txt");
  const secretsDir = join(dir, "secrets");
  await writeFile(identityFile, await generateIdentity());
  return { dir, identityFile, secretsDir };
}

function gcpClientMock(secretValue: string) {
  const accessSecretVersion = vi
    .fn()
    .mockResolvedValue([{ payload: { data: Buffer.from(secretValue) } }]);
  const client = {
    accessSecretVersion,
    getSecret: vi.fn(),
    createSecret: vi.fn(),
    addSecretVersion: vi.fn()
  };
  return { client: client as unknown as SecretManagerServiceClient, accessSecretVersion };
}

describe("resolver → providers", () => {
  it("resolves an age secret end-to-end through the resolver", async () => {
    const { dir, identityFile, secretsDir } = await ageFixture();

    const registry = new ProviderRegistry();
    const ageProvider = new AgeProvider();
    registry.register(ageProvider);

    await ageProvider.set(
      {
        keyPath: "github/token",
        envName: undefined,
        rootDir: dir,
        config: { identityFile, secretsDir }
      },
      "ghp_secret_value"
    );

    const normalized = normalizeConfig(
      defineConfig({
        name: "myapp",
        envs: ["dev"],
        keys: {
          github: {
            token: secret({
              value: age({ identityFile, secretsDir })
            })
          }
        }
      })
    );

    const resolved = await resolveResult({
      config: normalized,
      rootDir: dir,
      registry
    });

    expect(resolved).toEqual([{ path: "github/token", value: "ghp_secret_value" }]);
  });

  it("uses keyshelf name + env in the gcp secret id", async () => {
    const { client, accessSecretVersion } = gcpClientMock("dbpass");

    const registry = new ProviderRegistry();
    registry.register(new GcpSmProvider(client));

    const normalized = normalizeConfig(
      defineConfig({
        name: "myapp",
        envs: ["staging"],
        keys: {
          db: {
            password: secret({
              value: gcp({ project: "my-gcp-proj" })
            })
          }
        }
      })
    );

    const resolved = await resolveResult({
      config: normalized,
      rootDir: "/repo",
      envName: "staging",
      registry
    });

    expect(resolved).toEqual([{ path: "db/password", value: "dbpass" }]);
    expect(accessSecretVersion).toHaveBeenCalledWith({
      name: "projects/my-gcp-proj/secrets/keyshelf__myapp__staging__db__password/versions/latest"
    });
  });

  it("omits the env segment for envless gcp secrets", async () => {
    const { client, accessSecretVersion } = gcpClientMock("ghp_xxx");

    const registry = new ProviderRegistry();
    registry.register(new GcpSmProvider(client));

    const normalized = normalizeConfig(
      defineConfig({
        name: "myapp",
        envs: ["dev"],
        keys: {
          github: {
            token: secret({
              value: gcp({ project: "my-gcp-proj" })
            })
          },
          // template ref so the resolver still has a config record
          dummy: config({ value: "x" })
        }
      })
    );

    const resolved = await resolveResult({
      config: normalized,
      rootDir: "/repo",
      registry
    });

    expect(resolved.find((entry) => entry.path === "github/token")).toEqual({
      path: "github/token",
      value: "ghp_xxx"
    });
    expect(accessSecretVersion).toHaveBeenCalledWith({
      name: "projects/my-gcp-proj/secrets/keyshelf__myapp__github__token/versions/latest"
    });
  });

  it("resolves a TS plain() secret through the registered plain provider", async () => {
    const registry = new ProviderRegistry();
    registry.register(new PlaintextProvider());

    const normalized = normalizeConfig(
      defineConfig({
        name: "myapp",
        envs: ["dev", "mirror"],
        keys: {
          web: {
            "client-secret": secret({
              values: {
                dev: plain("dev-stub"),
                mirror: plain("")
              }
            })
          }
        }
      })
    );

    const dev = await resolveResult({
      config: normalized,
      rootDir: "/repo",
      envName: "dev",
      registry
    });
    const mirror = await resolveResult({
      config: normalized,
      rootDir: "/repo",
      envName: "mirror",
      registry
    });

    expect(dev).toEqual([{ path: "web/client-secret", value: "dev-stub" }]);
    expect(mirror).toEqual([{ path: "web/client-secret", value: "" }]);
  });

  it("resolves a YAML !plain secret through the registered plain provider", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyshelf-plain-yaml-"));
    await mkdir(join(root, ".keyshelf"));
    await writeFile(
      join(root, "keyshelf.yaml"),
      ["name: app", "keys:", "  web:", "    client-secret: !secret"].join("\n")
    );
    await writeFile(
      join(root, ".keyshelf/dev.yaml"),
      ["keys:", "  web:", '    client-secret: !plain "yaml-stub"'].join("\n")
    );

    const registry = new ProviderRegistry();
    registry.register(new PlaintextProvider());

    const normalized = normalizeConfig(await loadYamlConfig(join(root, "keyshelf.yaml")));
    const resolved = await resolveResult({
      config: normalized,
      rootDir: root,
      envName: "dev",
      registry
    });

    expect(resolved).toEqual([{ path: "web/client-secret", value: "yaml-stub" }]);
  });
});
