import { describe, expect, it, vi } from "vitest";
import type { Provider } from "../../../src/providers/types.js";
import { ProviderRegistry } from "../../../src/providers/registry.js";
import {
  age,
  config,
  defineConfig,
  normalizeConfig,
  renderAppMapping,
  resolve,
  resolveWithStatus,
  secret,
  validate
} from "../../../src/v5/index.js";

function mockProvider(name: string, resolveValue = "provider-value"): Provider {
  return {
    name,
    resolve: vi.fn().mockResolvedValue(resolveValue),
    validate: vi.fn().mockResolvedValue(true),
    set: vi.fn().mockResolvedValue(undefined)
  };
}

function registry(...providers: Provider[]): ProviderRegistry {
  const value = new ProviderRegistry();
  for (const provider of providers) value.register(provider);
  return value;
}

describe("v5 resolver", () => {
  it("resolves values by env before falling back to value/default", async () => {
    const provider = mockProvider("age", "secret-dev");
    const normalized = normalizeConfig(
      defineConfig({
        envs: ["dev", "production"],
        keys: {
          host: config({
            default: "localhost",
            values: { production: "prod-db" }
          }),
          port: 5432,
          token: secret({
            values: { dev: age({ identityFile: "./dev.txt" }) },
            default: age({ identityFile: "./shared.txt" })
          })
        }
      })
    );

    await expect(
      resolve({
        config: normalized,
        envName: "dev",
        rootDir: "/repo",
        registry: registry(provider)
      })
    ).resolves.toEqual([
      { path: "host", value: "localhost" },
      { path: "port", value: "5432" },
      { path: "token", value: "secret-dev" }
    ]);

    expect(provider.resolve).toHaveBeenCalledWith({
      keyPath: "token",
      envName: "dev",
      rootDir: "/repo",
      config: { identityFile: "./dev.txt" }
    });
  });

  it("reports required missing keys and skips optional keys with no active binding", async () => {
    const normalized = normalizeConfig(
      defineConfig({
        envs: ["dev", "production"],
        keys: {
          required: config({ values: { production: "prod" } }),
          optional: config({ optional: true, values: { production: "prod" } })
        }
      })
    );

    const errors = await validate({
      config: normalized,
      envName: "dev",
      rootDir: "/repo",
      registry: registry()
    });

    expect(errors).toMatchObject([
      {
        path: "required",
        message: 'No value for required key "required"'
      }
    ]);

    const resolution = await resolveWithStatus({
      config: normalized,
      envName: "dev",
      rootDir: "/repo",
      registry: registry()
    });
    expect(resolution.statusByPath.get("optional")).toMatchObject({
      status: "skipped",
      reason: "optional key 'optional' has no value"
    });
  });

  it("requires env only when a selected key has env-specific values without a fallback", async () => {
    const normalized = normalizeConfig(
      defineConfig({
        envs: ["dev", "production"],
        groups: ["app", "ci"],
        keys: {
          app: config({ group: "app", value: "envless", values: { production: "prod" } }),
          ci: config({ group: "ci", values: { production: "ci-prod" } })
        }
      })
    );

    await expect(
      resolve({
        config: normalized,
        groups: ["app"],
        rootDir: "/repo",
        registry: registry()
      })
    ).resolves.toEqual([{ path: "app", value: "envless" }]);

    await expect(
      resolve({
        config: normalized,
        groups: ["ci"],
        rootDir: "/repo",
        registry: registry()
      })
    ).rejects.toThrow('--env is required because selected key "ci"');
  });

  it("filters by group and path prefix while keeping groupless records shared", async () => {
    const normalized = normalizeConfig(
      defineConfig({
        envs: ["dev"],
        groups: ["app", "ci"],
        keys: {
          shared: "yes",
          app: {
            name: config({ group: "app", value: "keyshelf" }),
            url: config({ group: "app", value: "https://example.test" })
          },
          ci: {
            token: secret({ group: "ci", value: age({ identityFile: "./ci.txt" }) })
          }
        }
      })
    );

    await expect(
      resolve({
        config: normalized,
        groups: ["app"],
        filters: ["app/name", "shared"],
        envName: "dev",
        rootDir: "/repo",
        registry: registry(mockProvider("age"))
      })
    ).resolves.toEqual([
      { path: "shared", value: "yes" },
      { path: "app/name", value: "keyshelf" }
    ]);
  });

  it("rejects unknown envs, unknown groups, and group filters on groupless configs", async () => {
    const groupless = normalizeConfig(
      defineConfig({
        envs: ["dev"],
        keys: { app: "keyshelf" }
      })
    );
    const grouped = normalizeConfig(
      defineConfig({
        envs: ["dev"],
        groups: ["app"],
        keys: { app: config({ group: "app", value: "keyshelf" }) }
      })
    );

    await expect(
      resolve({ config: grouped, envName: "prod", rootDir: "/repo", registry: registry() })
    ).rejects.toThrow('Unknown env "prod"');

    await expect(
      resolve({
        config: grouped,
        groups: ["ci"],
        envName: "dev",
        rootDir: "/repo",
        registry: registry()
      })
    ).rejects.toThrow('Unknown group "ci"');

    await expect(
      resolve({
        config: groupless,
        groups: ["app"],
        envName: "dev",
        rootDir: "/repo",
        registry: registry()
      })
    ).rejects.toThrow("--group cannot be used");
  });

  it("interpolates config templates and treats filtered references as unavailable", async () => {
    const provider = mockProvider("age", "s3cr3t");
    const normalized = normalizeConfig(
      defineConfig({
        envs: ["dev"],
        groups: ["app", "ci"],
        keys: {
          db: {
            host: config({ group: "app", value: "localhost" }),
            password: secret({ group: "ci", value: age({ identityFile: "./ci.txt" }) }),
            url: config({
              group: "app",
              value: "postgres://${db/password}@${db/host}/app"
            })
          }
        }
      })
    );

    const all = await resolve({
      config: normalized,
      envName: "dev",
      rootDir: "/repo",
      registry: registry(provider)
    });
    expect(all).toContainEqual({ path: "db/url", value: "postgres://s3cr3t@localhost/app" });

    const appOnly = await resolveWithStatus({
      config: normalized,
      groups: ["app"],
      envName: "dev",
      rootDir: "/repo",
      registry: registry(provider)
    });
    expect(appOnly.statusByPath.get("db/url")).toMatchObject({
      status: "skipped",
      reason: "referenced key 'db/password' is filtered out"
    });
  });

  it("renders app mappings with per-env-var skip statuses", async () => {
    const normalized = normalizeConfig(
      defineConfig({
        envs: ["dev"],
        groups: ["app", "ci"],
        keys: {
          app: {
            host: config({ group: "app", value: "localhost" }),
            optional: config({ group: "app", optional: true })
          },
          ci: {
            token: secret({ group: "ci", value: age({ identityFile: "./ci.txt" }) })
          }
        }
      })
    );
    const resolution = await resolveWithStatus({
      config: normalized,
      groups: ["app"],
      envName: "dev",
      rootDir: "/repo",
      registry: registry(mockProvider("age"))
    });

    expect(
      renderAppMapping(
        [
          { envVar: "APP_HOST", keyPath: "app/host" },
          { envVar: "TOKEN", keyPath: "ci/token" },
          {
            envVar: "COMBINED",
            template: "${app/host}:${ci/token}",
            keyPaths: ["app/host", "ci/token"]
          },
          { envVar: "OPTIONAL", keyPath: "app/optional" }
        ],
        resolution
      )
    ).toMatchObject([
      { envVar: "APP_HOST", status: "rendered", value: "localhost" },
      {
        envVar: "TOKEN",
        status: "skipped",
        keyPath: "ci/token",
        reason: "referenced key 'ci/token' is filtered out"
      },
      {
        envVar: "COMBINED",
        status: "skipped",
        keyPath: "ci/token",
        reason: "referenced key 'ci/token' is filtered out"
      },
      {
        envVar: "OPTIONAL",
        status: "skipped",
        keyPath: "app/optional",
        reason: "referenced key 'app/optional' is unavailable"
      }
    ]);
  });

  it("skips optional not-found provider errors and propagates other provider errors", async () => {
    const notFoundProvider = mockProvider("age");
    (notFoundProvider.resolve as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("NOT_FOUND: Secret not found")
    );
    const authProvider = mockProvider("age");
    (authProvider.resolve as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("auth failed"));

    const normalized = normalizeConfig(
      defineConfig({
        envs: ["dev"],
        keys: {
          token: secret({ optional: true, value: age({ identityFile: "./ci.txt" }) })
        }
      })
    );

    await expect(
      resolve({
        config: normalized,
        envName: "dev",
        rootDir: "/repo",
        registry: registry(notFoundProvider)
      })
    ).resolves.toEqual([]);

    const errors = await validate({
      config: normalized,
      envName: "dev",
      rootDir: "/repo",
      registry: registry(authProvider)
    });
    expect(errors).toMatchObject([{ path: "token", message: "auth failed" }]);
  });
});
