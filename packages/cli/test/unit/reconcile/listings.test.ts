import { describe, expect, it, vi } from "vitest";
import {
  age,
  config,
  defineConfig,
  gcp,
  normalizeConfig,
  secret
} from "../../../src/config/index.js";
import { ProviderRegistry } from "../../../src/providers/registry.js";
import type {
  Provider,
  ProviderListContext,
  StorageScope,
  StoredKey
} from "../../../src/providers/types.js";
import { gatherListings } from "../../../src/reconcile/listings.js";

class StubProvider implements Provider {
  storageScope: StorageScope;
  list: (ctx: ProviderListContext) => Promise<StoredKey[]>;

  constructor(
    public name: string,
    storageScope: StorageScope,
    list: (ctx: ProviderListContext) => Promise<StoredKey[]>
  ) {
    this.storageScope = storageScope;
    this.list = list;
  }

  resolve(): Promise<string> {
    return Promise.reject(new Error("not used"));
  }
  validate(): Promise<boolean> {
    return Promise.resolve(false);
  }
  set(): Promise<void> {
    return Promise.resolve();
  }
}

function buildRegistry(providers: Provider[]): ProviderRegistry {
  const registry = new ProviderRegistry();
  for (const p of providers) registry.register(p);
  return registry;
}

const ageOpts = { identityFile: "./id.txt", secretsDir: "./secrets" };
const gcpOpts = { project: "proj-a" };

describe("gatherListings", () => {
  it("calls list once per distinct (provider, params) instance referenced by config", async () => {
    const ageList = vi
      .fn<(ctx: ProviderListContext) => Promise<StoredKey[]>>()
      .mockResolvedValue([{ keyPath: "token", envName: undefined }]);
    const gcpList = vi
      .fn<(ctx: ProviderListContext) => Promise<StoredKey[]>>()
      .mockResolvedValue([{ keyPath: "db/password", envName: "production" }]);

    const registry = buildRegistry([
      new StubProvider("age", "envless", ageList),
      new StubProvider("gcp", "perEnv", gcpList)
    ]);

    const cfg = normalizeConfig(
      defineConfig({
        name: "test",
        envs: ["dev", "production"],
        keys: {
          // Same age instance referenced twice — should be listed once.
          tokenA: secret({ value: age(ageOpts) }),
          tokenB: secret({ value: age(ageOpts) }),
          db: {
            password: secret({ values: { production: gcp(gcpOpts) } })
          }
        }
      })
    );

    const result = await gatherListings({ config: cfg, registry, rootDir: "/tmp/root" });

    expect(ageList).toHaveBeenCalledTimes(1);
    expect(gcpList).toHaveBeenCalledTimes(1);

    // Listings include storageScope from the provider instance.
    const ageListing = result.listings.find((l) => l.providerName === "age");
    const gcpListing = result.listings.find((l) => l.providerName === "gcp");
    expect(ageListing?.storageScope).toBe("envless");
    expect(gcpListing?.storageScope).toBe("perEnv");
    expect(ageListing?.providerParams).toEqual(ageOpts);
    expect(gcpListing?.providerParams).toEqual(gcpOpts);
    expect(result.failures).toEqual([]);
  });

  it("propagates keyshelfName and envs into the list context", async () => {
    const ageList = vi
      .fn<(ctx: ProviderListContext) => Promise<StoredKey[]>>()
      .mockResolvedValue([]);
    const registry = buildRegistry([new StubProvider("age", "envless", ageList)]);

    const cfg = normalizeConfig(
      defineConfig({
        name: "myapp",
        envs: ["dev", "prod"],
        keys: { token: secret({ value: age(ageOpts) }) }
      })
    );

    await gatherListings({ config: cfg, registry, rootDir: "/tmp/root" });

    const ctxArg = ageList.mock.calls[0][0];
    expect(ctxArg.keyshelfName).toBe("myapp");
    expect(ctxArg.envs).toEqual(["dev", "prod"]);
    expect(ctxArg.rootDir).toBe("/tmp/root");
    expect(ctxArg.config).toEqual(ageOpts);
  });

  it("collects failures rather than throwing when a provider list call rejects", async () => {
    const failing = vi
      .fn<(ctx: ProviderListContext) => Promise<StoredKey[]>>()
      .mockRejectedValue(new Error("auth missing"));
    const registry = buildRegistry([new StubProvider("age", "envless", failing)]);

    const cfg = normalizeConfig(
      defineConfig({
        name: "test",
        envs: ["dev"],
        keys: { token: secret({ value: age(ageOpts) }) }
      })
    );

    const result = await gatherListings({ config: cfg, registry, rootDir: "/tmp/root" });
    expect(result.listings).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].providerName).toBe("age");
    expect(result.failures[0].error.message).toBe("auth missing");
  });

  it("ignores config-kind records (no provider listing required)", async () => {
    const ageList = vi
      .fn<(ctx: ProviderListContext) => Promise<StoredKey[]>>()
      .mockResolvedValue([]);
    const registry = buildRegistry([new StubProvider("age", "envless", ageList)]);

    const cfg = normalizeConfig(
      defineConfig({
        name: "test",
        envs: ["dev"],
        keys: { host: config({ default: "localhost" }) }
      })
    );

    const result = await gatherListings({ config: cfg, registry, rootDir: "/tmp/root" });
    expect(result.listings).toEqual([]);
    expect(ageList).not.toHaveBeenCalled();
  });
});
