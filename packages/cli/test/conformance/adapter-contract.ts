import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Adapter } from "../../src/adapters/adapter.js";
import { captureError } from "../support/capture-error.js";

/**
 * A per-adapter harness: the only thing that knows which adapter is behind the
 * suite. It provisions a fresh, isolated backend for each test and hands back an
 * {@link Adapter} bound to it, then tears the backend down. A new adapter runs
 * the identical suite below simply by supplying one of these (ADR-0005).
 */
export interface AdapterHarness {
  /** A label for the test report (e.g. `'fake'`). */
  readonly name: string;
  /**
   * Whether the backend can store an empty string. Defaults to `true`. The gcp
   * adapter sets this `false`: Secret Manager rejects an empty payload and an
   * empty secret has no native form to mount, so it rejects empty values with
   * `ADAPTER_ERROR` (ADR-0006). This is the contract's one sanctioned per-backend
   * divergence in value fidelity.
   */
  readonly supportsEmptyValue?: boolean;
  /** Provision a fresh backend + adapter for a single test. */
  setup(): Promise<{ adapter: Adapter }>;
  /** Tear down whatever {@link setup} provisioned. */
  teardown(): Promise<void>;
}

/**
 * Adversarial values that must round-trip byte-exactly through any adapter. The
 * empty string is handled separately because not every backend can represent it
 * (see {@link AdapterHarness.supportsEmptyValue}).
 */
const ADVERSARIAL_VALUES: ReadonlyArray<readonly [label: string, value: string]> = [
  ["embedded newlines", "line1\nline2\nline3"],
  ["trailing/leading whitespace", "  padded value \t"],
  ["equals signs", "postgres://h?a=b=c&d=e"],
  ["single and double quotes", `it's a "quoted" 'value'`],
  ["unicode", "café — 日本語 — 🔐 — Ω"],
  ["multi-KB blob", "x".repeat(8192)]
];

/**
 * The shared, adapter-agnostic contract suite (ADR-0005). It exercises the
 * `resolve`/`write` interface directly and bakes in the two cross-cutting
 * dimensions every adapter must satisfy: error-code mapping and value fidelity.
 * It knows nothing about which adapter is behind it — that is the harness's job.
 */
export function runAdapterContractSuite(harness: AdapterHarness): void {
  describe(`adapter contract: ${harness.name}`, () => {
    let adapter: Adapter;

    beforeEach(async () => {
      ({ adapter } = await harness.setup());
    });

    afterEach(async () => {
      await harness.teardown();
    });

    describe("error-code mapping", () => {
      it("maps a missing secret to SECRET_NOT_FOUND", async () => {
        const error = await captureError(() => adapter.resolve("ABSENT_KEY"));
        expect(error.code).toBe("SECRET_NOT_FOUND");
      });

      it("maps a missing secret behind an explicit ref to SECRET_NOT_FOUND", async () => {
        const error = await captureError(() =>
          adapter.resolve("SOME_KEY", { ref: "nonexistent-foreign-name" })
        );
        expect(error.code).toBe("SECRET_NOT_FOUND");
      });
    });

    describe("value fidelity (byte-exact write -> resolve round-trip)", () => {
      for (const [label, value] of ADVERSARIAL_VALUES) {
        it(`round-trips ${label}`, async () => {
          await adapter.write("FIDELITY_KEY", value);
          const resolved = await adapter.resolve("FIDELITY_KEY");
          expect(resolved).toBe(value);
        });
      }

      if (harness.supportsEmptyValue ?? true) {
        it("round-trips the empty string", async () => {
          await adapter.write("FIDELITY_KEY", "");
          expect(await adapter.resolve("FIDELITY_KEY")).toBe("");
        });
      } else {
        it("rejects an empty value with ADAPTER_ERROR", async () => {
          const error = await captureError(() => adapter.write("FIDELITY_KEY", ""));
          expect(error.code).toBe("ADAPTER_ERROR");
        });
      }

      it("keeps distinct keys independent", async () => {
        await adapter.write("KEY_A", "value-a");
        await adapter.write("KEY_B", "value-b");
        expect(await adapter.resolve("KEY_A")).toBe("value-a");
        expect(await adapter.resolve("KEY_B")).toBe("value-b");
      });

      it("overwrites an existing value on a repeated write", async () => {
        await adapter.write("KEY", "first");
        await adapter.write("KEY", "second");
        expect(await adapter.resolve("KEY")).toBe("second");
      });

      it("resolves a foreign value through an explicit ref returned by write", async () => {
        // A write may return a reference that names the stored value; resolving
        // with that ref must locate the same value even under a different key.
        const ref = await adapter.write("CANONICAL_KEY", "foreign-value");
        const resolved = await adapter.resolve("A_DIFFERENT_KEY", ref ?? "CANONICAL_KEY");
        expect(resolved).toBe("foreign-value");
      });
    });
  });
}
