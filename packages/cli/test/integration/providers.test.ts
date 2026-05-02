import { describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { age, config, defineConfig, secret, gcp } from "../../src/config/index.js";
import { normalizeConfig } from "../../src/config/index.js";
import { resolve as resolveResult } from "../../src/resolver/index.js";
import { ProviderRegistry } from "../../src/providers/registry.js";
import { AgeProvider, generateIdentity } from "../../src/providers/age.js";
import { GcpSmProvider } from "../../src/providers/gcp-sm.js";

async function ageFixture() {
  const dir = await mkdtemp(join(tmpdir(), "keyshelf-age-"));
  const identityFile = join(dir, "id.txt");
  const secretsDir = join(dir, "secrets");
  await writeFile(identityFile, await generateIdentity());
  return { dir, identityFile, secretsDir };
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
    const accessSecretVersion = vi
      .fn()
      .mockResolvedValue([{ payload: { data: Buffer.from("dbpass") } }]);
    const client = {
      accessSecretVersion,
      getSecret: vi.fn(),
      createSecret: vi.fn(),
      addSecretVersion: vi.fn()
    };

    const registry = new ProviderRegistry();
    registry.register(new GcpSmProvider(client as unknown as SecretManagerServiceClient));

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
    const accessSecretVersion = vi
      .fn()
      .mockResolvedValue([{ payload: { data: Buffer.from("ghp_xxx") } }]);
    const client = {
      accessSecretVersion,
      getSecret: vi.fn(),
      createSecret: vi.fn(),
      addSecretVersion: vi.fn()
    };

    const registry = new ProviderRegistry();
    registry.register(new GcpSmProvider(client as unknown as SecretManagerServiceClient));

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
});
