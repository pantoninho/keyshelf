import { describe, expect, it, vi } from "vitest";
import { defineConfig, normalizeConfig } from "../../../src/config/index.js";
import { ProviderRegistry } from "../../../src/providers/registry.js";
import type {
  Provider,
  ProviderContext,
  ProviderListContext,
  StorageScope,
  StoredKey
} from "../../../src/providers/types.js";
import {
  AmbiguousActionsError,
  ApplyValidationError,
  applyPlan
} from "../../../src/reconcile/apply.js";
import type { Plan } from "../../../src/reconcile/plan.js";

class StubProvider implements Provider {
  name: string;
  storageScope: StorageScope;
  copy = vi.fn<(from: ProviderContext, to: ProviderContext) => Promise<void>>().mockResolvedValue();
  validate = vi.fn<(ctx: ProviderContext) => Promise<boolean>>().mockResolvedValue(true);
  delete = vi.fn<(ctx: ProviderContext) => Promise<void>>().mockResolvedValue();

  constructor(name: string, storageScope: StorageScope = "envless") {
    this.name = name;
    this.storageScope = storageScope;
  }

  resolve(): Promise<string> {
    return Promise.reject(new Error("not used"));
  }
  set(): Promise<void> {
    return Promise.resolve();
  }
  list(_ctx: ProviderListContext): Promise<StoredKey[]> {
    void _ctx;
    return Promise.resolve([]);
  }
}

function buildRegistry(providers: Provider[]): ProviderRegistry {
  const registry = new ProviderRegistry();
  for (const p of providers) registry.register(p);
  return registry;
}

const cfg = normalizeConfig(
  defineConfig({
    name: "myapp",
    envs: ["dev", "prod"],
    keys: { _placeholder: "x" }
  })
);

const ageParams = { identityFile: "./id.txt", secretsDir: "./secrets" };

describe("applyPlan", () => {
  it("executes a Rename as copy → validate → delete, in that order, per env binding", async () => {
    const age = new StubProvider("age");
    const callOrder: string[] = [];
    age.copy.mockImplementation(async () => {
      callOrder.push("copy");
    });
    age.validate.mockImplementation(async () => {
      callOrder.push("validate");
      return true;
    });
    age.delete.mockImplementation(async () => {
      callOrder.push("delete");
    });

    const plan: Plan = [
      {
        kind: "rename",
        from: { keyPath: "old/path" },
        to: { keyPath: "new/path" },
        providerName: "age",
        providerParams: ageParams,
        envBindings: [undefined]
      }
    ];

    const result = await applyPlan(
      { config: cfg, registry: buildRegistry([age]), rootDir: "/tmp/root" },
      plan
    );

    expect(callOrder).toEqual(["copy", "validate", "delete"]);
    expect(result).toEqual({ renamesApplied: 1, deletesApplied: 0 });
  });

  it("propagates providerParams and rootDir into the ProviderContext", async () => {
    const age = new StubProvider("age");
    const plan: Plan = [
      {
        kind: "rename",
        from: { keyPath: "old" },
        to: { keyPath: "new" },
        providerName: "age",
        providerParams: ageParams,
        envBindings: [undefined]
      }
    ];

    await applyPlan({ config: cfg, registry: buildRegistry([age]), rootDir: "/tmp/root" }, plan);

    const fromArg = age.copy.mock.calls[0][0];
    const toArg = age.copy.mock.calls[0][1];
    expect(fromArg.config).toEqual(ageParams);
    expect(fromArg.rootDir).toBe("/tmp/root");
    expect(fromArg.keyshelfName).toBe("myapp");
    expect(fromArg.keyPath).toBe("old");
    expect(toArg.keyPath).toBe("new");
  });

  it("processes each envBinding sequentially for a per-env rename", async () => {
    const gcp = new StubProvider("gcp", "perEnv");
    const order: string[] = [];
    gcp.copy.mockImplementation(async (_from, to) => {
      order.push(`copy:${to.envName}`);
    });
    gcp.validate.mockImplementation(async (ctx) => {
      order.push(`validate:${ctx.envName}`);
      return true;
    });
    gcp.delete.mockImplementation(async (ctx) => {
      order.push(`delete:${ctx.envName}`);
    });

    const plan: Plan = [
      {
        kind: "rename",
        from: { keyPath: "old" },
        to: { keyPath: "new" },
        providerName: "gcp",
        providerParams: { project: "p" },
        envBindings: ["dev", "prod"]
      }
    ];

    await applyPlan({ config: cfg, registry: buildRegistry([gcp]), rootDir: "/r" }, plan);

    expect(order).toEqual([
      "copy:dev",
      "validate:dev",
      "delete:dev",
      "copy:prod",
      "validate:prod",
      "delete:prod"
    ]);
  });

  it("aborts on validate failure: source remains intact (delete never called)", async () => {
    const age = new StubProvider("age");
    age.validate.mockResolvedValue(false);

    const plan: Plan = [
      {
        kind: "rename",
        from: { keyPath: "old" },
        to: { keyPath: "new" },
        providerName: "age",
        providerParams: ageParams,
        envBindings: [undefined]
      }
    ];

    await expect(
      applyPlan({ config: cfg, registry: buildRegistry([age]), rootDir: "/r" }, plan)
    ).rejects.toBeInstanceOf(ApplyValidationError);

    expect(age.copy).toHaveBeenCalledTimes(1);
    expect(age.delete).not.toHaveBeenCalled();
  });

  it("executes a standalone Delete as a single delete call", async () => {
    const age = new StubProvider("age");

    const plan: Plan = [
      {
        kind: "delete",
        keyPath: "legacy/orphan",
        envName: undefined,
        providerName: "age",
        providerParams: ageParams
      }
    ];

    const result = await applyPlan(
      { config: cfg, registry: buildRegistry([age]), rootDir: "/r" },
      plan
    );

    expect(age.delete).toHaveBeenCalledTimes(1);
    expect(age.delete.mock.calls[0][0].keyPath).toBe("legacy/orphan");
    expect(result).toEqual({ renamesApplied: 0, deletesApplied: 1 });
  });

  it("runs all renames before any standalone deletes", async () => {
    const age = new StubProvider("age");
    const order: string[] = [];
    age.copy.mockImplementation(async (_from, to) => {
      order.push(`copy:${to.keyPath}`);
    });
    age.delete.mockImplementation(async (ctx) => {
      order.push(`delete:${ctx.keyPath}`);
    });

    const plan: Plan = [
      {
        kind: "delete",
        keyPath: "orphan",
        envName: undefined,
        providerName: "age",
        providerParams: ageParams
      },
      {
        kind: "rename",
        from: { keyPath: "from" },
        to: { keyPath: "to" },
        providerName: "age",
        providerParams: ageParams,
        envBindings: [undefined]
      }
    ];

    await applyPlan({ config: cfg, registry: buildRegistry([age]), rootDir: "/r" }, plan);

    expect(order).toEqual(["copy:to", "delete:from", "delete:orphan"]);
  });

  it("skips Create and NoOp actions (they don't touch storage in apply)", async () => {
    const age = new StubProvider("age");

    const plan: Plan = [
      { kind: "create", keyPath: "new", envName: undefined, providerName: "age" },
      { kind: "noop", keyPath: "stable", envName: undefined, providerName: "age" }
    ];

    const result = await applyPlan(
      { config: cfg, registry: buildRegistry([age]), rootDir: "/r" },
      plan
    );

    expect(age.copy).not.toHaveBeenCalled();
    expect(age.delete).not.toHaveBeenCalled();
    expect(result).toEqual({ renamesApplied: 0, deletesApplied: 0 });
  });

  it("refuses to apply when the plan contains Ambiguous actions", async () => {
    const age = new StubProvider("age");

    const plan: Plan = [
      {
        kind: "ambiguous",
        desired: { keyPath: "new", providerName: "age" },
        candidates: [
          { keyPath: "oldA", providerName: "age" },
          { keyPath: "oldB", providerName: "age" }
        ],
        hint: "..."
      },
      {
        kind: "delete",
        keyPath: "other",
        envName: undefined,
        providerName: "age",
        providerParams: ageParams
      }
    ];

    await expect(
      applyPlan({ config: cfg, registry: buildRegistry([age]), rootDir: "/r" }, plan)
    ).rejects.toBeInstanceOf(AmbiguousActionsError);

    expect(age.copy).not.toHaveBeenCalled();
    expect(age.delete).not.toHaveBeenCalled();
  });

  it("is idempotent: an empty plan applies cleanly with zero counts", async () => {
    const age = new StubProvider("age");
    const result = await applyPlan(
      { config: cfg, registry: buildRegistry([age]), rootDir: "/r" },
      []
    );
    expect(result).toEqual({ renamesApplied: 0, deletesApplied: 0 });
    expect(age.copy).not.toHaveBeenCalled();
    expect(age.delete).not.toHaveBeenCalled();
  });
});
