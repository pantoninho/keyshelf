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
  /**
   * Whether the backend versions its store and honors a pinned `version` on a
   * `!secret` reference (ADR-0009). Defaults to `false`: most stores hold one
   * value per key. The gcp adapter sets this `true` and runs the pinning cases —
   * `write` reports the version it created, a pinned `resolve` returns exactly
   * that version, a bare `resolve` returns `latest`, and `latestVersion` reads
   * the current version. sops/fake leave it `false` (their stores hold one value,
   * already deploy-gated for sops), so those cases are skipped for them.
   */
  readonly supportsVersionPinning?: boolean;
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
        const { ref } = await adapter.write("CANONICAL_KEY", "foreign-value");
        const resolved = await adapter.resolve("A_DIFFERENT_KEY", ref ?? "CANONICAL_KEY");
        expect(resolved).toBe("foreign-value");
      });
    });

    if (harness.supportsVersionPinning ?? false) {
      describe("version pinning (ADR-0009)", () => {
        it("write reports the concrete version it created", async () => {
          const first = await adapter.write("PINNED_KEY", "v1");
          const second = await adapter.write("PINNED_KEY", "v2");
          expect(first.version).toBeDefined();
          expect(second.version).toBeDefined();
          expect(second.version).not.toBe(first.version);
        });

        it("a pinned resolve returns exactly that version, not latest", async () => {
          const v1 = await adapter.write("PINNED_KEY", "value-1");
          await adapter.write("PINNED_KEY", "value-2");
          // Pinned to the first version: must return value-1 though latest is value-2.
          expect(await adapter.resolve("PINNED_KEY", { version: Number(v1.version) })).toBe(
            "value-1"
          );
          // A bare (floating) resolve returns latest.
          expect(await adapter.resolve("PINNED_KEY")).toBe("value-2");
        });

        it("latestVersion reads the current latest without writing", async () => {
          await adapter.write("PINNED_KEY", "value-1");
          const second = await adapter.write("PINNED_KEY", "value-2");
          expect(adapter.latestVersion).toBeDefined();
          expect(await adapter.latestVersion!("PINNED_KEY")).toBe(second.version);
          // Reading the latest does not add a version: latest is still value-2.
          expect(await adapter.resolve("PINNED_KEY")).toBe("value-2");
        });
      });
    }
  });
}
