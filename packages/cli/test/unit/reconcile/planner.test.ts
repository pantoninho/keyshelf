import { describe, expect, it } from "vitest";
import {
  age,
  config,
  defineConfig,
  gcp,
  normalizeConfig,
  secret
} from "../../../src/config/index.js";
import { planReconciliation } from "../../../src/reconcile/planner.js";
import type { ProviderListing } from "../../../src/reconcile/planner.js";
import type { Action } from "../../../src/reconcile/plan.js";

const ageOpts = { identityFile: "./id.txt", secretsDir: "./secrets" };
const gcpOpts = { project: "proj-a" };

function ageListing(keys: Array<{ keyPath: string }>): ProviderListing {
  return {
    providerName: "age",
    providerParams: ageOpts,
    storageScope: "envless",
    keys: keys.map((k) => ({ keyPath: k.keyPath, envName: undefined }))
  };
}

function gcpListing(
  keys: Array<{ keyPath: string; envName: string | undefined }>
): ProviderListing {
  return {
    providerName: "gcp",
    providerParams: gcpOpts,
    storageScope: "perEnv",
    keys
  };
}

function actionsByKind(actions: Action[]): Record<string, Action[]> {
  const out: Record<string, Action[]> = {};
  for (const a of actions) {
    if (out[a.kind] === undefined) out[a.kind] = [];
    out[a.kind].push(a);
  }
  return out;
}

describe("planReconciliation", () => {
  it("(a) clean state — every desired binding has matching storage → all NoOps", () => {
    const cfg = normalizeConfig(
      defineConfig({
        name: "test",
        envs: ["dev"],
        keys: {
          token: secret({ value: age(ageOpts) })
        }
      })
    );

    const plan = planReconciliation(cfg, [ageListing([{ keyPath: "token" }])]);

    expect(plan).toEqual([
      {
        kind: "noop",
        keyPath: "token",
        envName: undefined,
        providerName: "age"
      }
    ]);
  });

  it("(b) one new key — desired but no storage → Create", () => {
    const cfg = normalizeConfig(
      defineConfig({
        name: "test",
        envs: ["dev"],
        keys: {
          token: secret({ value: age(ageOpts) })
        }
      })
    );

    const plan = planReconciliation(cfg, [ageListing([])]);

    expect(plan).toEqual([
      {
        kind: "create",
        keyPath: "token",
        envName: undefined,
        providerName: "age"
      }
    ]);
  });

  it("(c) one orphan — storage exists for an undeclared key → Delete", () => {
    const cfg = normalizeConfig(
      defineConfig({
        name: "test",
        envs: ["dev"],
        keys: {
          // keep the instance alive in the listings map; otherwise an
          // unrelated declared key wouldn't be required.
          token: secret({ value: age(ageOpts) })
        }
      })
    );

    const plan = planReconciliation(cfg, [
      ageListing([{ keyPath: "token" }, { keyPath: "legacy/old-thing" }])
    ]);

    const byKind = actionsByKind(plan);
    expect(byKind.noop).toHaveLength(1);
    expect(byKind.delete).toEqual([
      {
        kind: "delete",
        keyPath: "legacy/old-thing",
        envName: undefined,
        providerName: "age"
      }
    ]);
  });

  it("(d) shape-unique rename — one orphan, one new key, same envCoverage → Rename", () => {
    const cfg = normalizeConfig(
      defineConfig({
        name: "test",
        envs: ["dev"],
        keys: {
          databases: {
            auth: { dbPassword: secret({ value: age(ageOpts) }) }
          }
        }
      })
    );

    const plan = planReconciliation(cfg, [ageListing([{ keyPath: "supabase/db-password" }])]);

    expect(plan).toEqual([
      {
        kind: "rename",
        from: { keyPath: "supabase/db-password" },
        to: { keyPath: "databases/auth/dbPassword" },
        providerName: "age",
        envBindings: [undefined]
      }
    ]);
  });

  it("(e) ambiguous — two orphans match one new key by shape → Ambiguous", () => {
    const cfg = normalizeConfig(
      defineConfig({
        name: "test",
        envs: ["dev"],
        keys: {
          newKey: secret({ value: age(ageOpts) })
        }
      })
    );

    const plan = planReconciliation(cfg, [
      ageListing([{ keyPath: "old-a" }, { keyPath: "old-b" }])
    ]);

    const byKind = actionsByKind(plan);
    expect(byKind.ambiguous).toHaveLength(1);
    const ambiguous = byKind.ambiguous[0];
    if (ambiguous.kind !== "ambiguous") throw new Error("expected ambiguous");
    expect(ambiguous.desired.keyPath).toBe("newKey");
    expect(ambiguous.candidates.map((c) => c.keyPath).sort()).toEqual(["old-a", "old-b"]);
    // While ambiguous is unresolved, neither side is emitted as Create/Delete.
    expect(byKind.create).toBeUndefined();
    expect(byKind.delete).toBeUndefined();
  });

  it("(f) movedFrom resolves ambiguity — picks the named candidate", () => {
    const cfg = normalizeConfig(
      defineConfig({
        name: "test",
        envs: ["dev"],
        keys: {
          newKey: secret({ value: age(ageOpts), movedFrom: "old-a" })
        }
      })
    );

    const plan = planReconciliation(cfg, [
      ageListing([{ keyPath: "old-a" }, { keyPath: "old-b" }])
    ]);

    const byKind = actionsByKind(plan);
    expect(byKind.rename).toEqual([
      {
        kind: "rename",
        from: { keyPath: "old-a" },
        to: { keyPath: "newKey" },
        providerName: "age",
        envBindings: [undefined]
      }
    ]);
    // old-b is left over → Delete (the movedFrom hint resolved old-a, but
    // old-b is still an orphan with no other claim on it).
    expect(byKind.delete).toEqual([
      {
        kind: "delete",
        keyPath: "old-b",
        envName: undefined,
        providerName: "age"
      }
    ]);
  });

  it("(g) per-env partial moves — gcp orphan covers dev but not prod", () => {
    const cfg = normalizeConfig(
      defineConfig({
        name: "test",
        envs: ["dev", "prod"],
        keys: {
          newKey: secret({
            values: { dev: gcp(gcpOpts), prod: gcp(gcpOpts) }
          })
        }
      })
    );

    const plan = planReconciliation(cfg, [gcpListing([{ keyPath: "old-key", envName: "dev" }])]);

    const byKind = actionsByKind(plan);
    // The orphan only covers dev, the desired wants dev+prod. envCoverage
    // doesn't match, so no shape rename is proposed. Both sides fall out
    // separately.
    expect(byKind.rename).toBeUndefined();
    expect(byKind.create?.map((a) => a.kind === "create" && a.envName).sort()).toEqual([
      "dev",
      "prod"
    ]);
    expect(byKind.delete).toEqual([
      {
        kind: "delete",
        keyPath: "old-key",
        envName: "dev",
        providerName: "gcp"
      }
    ]);
  });

  it("(g2) per-env rename via movedFrom — orphan dev moves to new path, prod is Create", () => {
    const cfg = normalizeConfig(
      defineConfig({
        name: "test",
        envs: ["dev", "prod"],
        keys: {
          newKey: secret({
            values: { dev: gcp(gcpOpts), prod: gcp(gcpOpts) },
            movedFrom: "old-key"
          })
        }
      })
    );

    const plan = planReconciliation(cfg, [gcpListing([{ keyPath: "old-key", envName: "dev" }])]);

    const byKind = actionsByKind(plan);
    // movedFrom forces the match even though envCoverage differs.
    // envBindings = intersection (just "dev"); prod stays as Create.
    expect(byKind.rename).toEqual([
      {
        kind: "rename",
        from: { keyPath: "old-key" },
        to: { keyPath: "newKey" },
        providerName: "gcp",
        envBindings: ["dev"]
      }
    ]);
    expect(byKind.create).toEqual([
      {
        kind: "create",
        keyPath: "newKey",
        envName: "prod",
        providerName: "gcp"
      }
    ]);
    expect(byKind.delete).toBeUndefined();
  });

  it("(h) provider-param drift — same path, different gcp project → not a rename", () => {
    const cfg = normalizeConfig(
      defineConfig({
        name: "test",
        envs: ["dev"],
        keys: {
          token: secret({ value: gcp({ project: "proj-b" }) })
        }
      })
    );

    // Listing for proj-a (the old project) holds the entry; listing for
    // proj-b is empty. The two are different instances.
    const plan = planReconciliation(cfg, [
      {
        providerName: "gcp",
        providerParams: { project: "proj-a" },
        storageScope: "perEnv",
        keys: [{ keyPath: "token", envName: "dev" }]
      },
      {
        providerName: "gcp",
        providerParams: { project: "proj-b" },
        storageScope: "perEnv",
        keys: []
      }
    ]);

    const byKind = actionsByKind(plan);
    // No rename — instances don't cross.
    expect(byKind.rename).toBeUndefined();
    expect(byKind.create).toEqual([
      {
        kind: "create",
        keyPath: "token",
        envName: "dev",
        providerName: "gcp"
      }
    ]);
    expect(byKind.delete).toEqual([
      {
        kind: "delete",
        keyPath: "token",
        envName: "dev",
        providerName: "gcp"
      }
    ]);
  });

  it("ignores config records — they don't touch storage", () => {
    const cfg = normalizeConfig(
      defineConfig({
        name: "test",
        envs: ["dev"],
        keys: {
          host: "localhost",
          port: config({ value: 5432 })
        }
      })
    );

    expect(planReconciliation(cfg, [])).toEqual([]);
  });
});
