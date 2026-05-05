import { describe, expect, it } from "vitest";
import { countMutatingActions, renderPlan } from "../../../src/reconcile/format.js";
import type { Plan } from "../../../src/reconcile/plan.js";

describe("renderPlan", () => {
  it("returns the in-sync banner for an empty plan", () => {
    expect(renderPlan([])).toBe("No changes. Storage is in sync with the config.\n");
  });

  it("treats noop-only plans as in-sync (no mutating actions)", () => {
    const plan: Plan = [
      { kind: "noop", keyPath: "token", envName: undefined, providerName: "age" }
    ];
    const out = renderPlan(plan);
    expect(out).toContain("No changes. Storage is in sync with the config.");
    expect(out).toContain("(1 unchanged)");
    expect(countMutatingActions(plan)).toBe(0);
  });

  it("renders create with provider and (where present) env suffix", () => {
    const plan: Plan = [
      { kind: "create", keyPath: "token", envName: undefined, providerName: "age" },
      { kind: "create", keyPath: "db/password", envName: "production", providerName: "gcp" }
    ];
    const out = renderPlan(plan);
    expect(out).toContain("+ token   (new — run `keyshelf set` to populate)");
    expect(out).toContain("provider: age");
    expect(out).toContain("+ db/password [production]");
    expect(out).toContain("provider: gcp");
    expect(out).toContain("2 to create");
  });

  it("renders delete actions with orphan annotation", () => {
    const plan: Plan = [
      { kind: "delete", keyPath: "legacy", envName: undefined, providerName: "age" }
    ];
    const out = renderPlan(plan);
    expect(out).toContain("- legacy   (orphan; will be deleted on apply)");
    expect(out).toContain("1 to delete");
  });

  it("renders rename actions with from/to and env bindings", () => {
    const plan: Plan = [
      {
        kind: "rename",
        from: { keyPath: "supabase/db-password" },
        to: { keyPath: "databases/auth/dbPassword" },
        providerName: "age",
        envBindings: [undefined]
      }
    ];
    const out = renderPlan(plan);
    expect(out).toContain("~ databases/auth/dbPassword   (renamed from supabase/db-password)");
    expect(out).toContain("envs: (envless)");
    expect(out).toContain("1 to rename");
  });

  it("renders ambiguous actions with candidate set and movedFrom snippet", () => {
    const plan: Plan = [
      {
        kind: "ambiguous",
        desired: { keyPath: "newKey", providerName: "age" },
        candidates: [
          { keyPath: "oldA", providerName: "age" },
          { keyPath: "oldB", providerName: "age" }
        ],
        hint: "annotate movedFrom on the new key to disambiguate."
      }
    ];
    const out = renderPlan(plan);
    expect(out).toContain("? newKey   (ambiguous rename)");
    expect(out).toContain("- oldA");
    expect(out).toContain("- oldB");
    expect(out).toContain('secret({ movedFrom: "oldA", ... })');
    expect(out).toContain('secret({ movedFrom: "oldB", ... })');
    expect(out).toContain("1 ambiguous");
  });

  it("counts mutating actions across kinds, ignoring noop", () => {
    const plan: Plan = [
      { kind: "noop", keyPath: "a", envName: undefined, providerName: "age" },
      { kind: "create", keyPath: "b", envName: undefined, providerName: "age" },
      { kind: "delete", keyPath: "c", envName: undefined, providerName: "age" },
      {
        kind: "rename",
        from: { keyPath: "d-old" },
        to: { keyPath: "d" },
        providerName: "age",
        envBindings: [undefined]
      },
      {
        kind: "ambiguous",
        desired: { keyPath: "e", providerName: "age" },
        candidates: [{ keyPath: "e-old", providerName: "age" }],
        hint: "..."
      }
    ];
    expect(countMutatingActions(plan)).toBe(4);
  });
});
