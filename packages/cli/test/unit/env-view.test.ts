import { describe, expect, it } from "vitest";
import type { Adapter, AdapterMetadata } from "../../src/adapters/adapter.js";
import {
  environmentKeyView,
  formatStatus,
  type Colorize,
  type KeyView
} from "../../src/env-view.js";
import type { LoadedEnvironment } from "../../src/model.js";

/** Assemble a minimal {@link LoadedEnvironment} from schema + environment keys. */
function loaded(
  schemaKeys: LoadedEnvironment["schema"]["keys"],
  environmentKeys: LoadedEnvironment["environment"]["keys"],
  stage = "production"
): LoadedEnvironment {
  return {
    config: { project: "myapp", providers: {} },
    schema: { keys: schemaKeys },
    environment: { shelf: "backend", name: stage, keys: environmentKeys }
  };
}

describe("environmentKeyView", () => {
  it("annotates each status against its schema presence", () => {
    const view = environmentKeyView(
      loaded(
        {
          DATABASE_URL: { kind: "required" },
          LOG_LEVEL: { kind: "config", default: "info" },
          REGION: { kind: "config", default: "eu-west-1" },
          SUPABASE_KEY: { kind: "required" },
          API_TOKEN: { kind: "required" },
          DEBUG: { kind: "optional" }
        },
        {
          DATABASE_URL: { kind: "secret" },
          LOG_LEVEL: { kind: "config", value: "debug" },
          SUPABASE_KEY: { kind: "ref", reference: { shelf: "supabase" } }
        }
      )
    );

    expect(view).toEqual<KeyView[]>([
      { key: "DATABASE_URL", presence: "required", status: "secret" },
      { key: "LOG_LEVEL", presence: "default", status: "config" },
      { key: "REGION", presence: "default", status: "default" },
      {
        key: "SUPABASE_KEY",
        presence: "required",
        status: "ref",
        reference: { shelf: "supabase", stage: "production", key: "SUPABASE_KEY" }
      },
      { key: "API_TOKEN", presence: "required", status: "missing" },
      { key: "DEBUG", presence: "optional", status: "unset" }
    ]);
  });

  it("lists every schema key in declaration order, not environment order", () => {
    const view = environmentKeyView(
      loaded(
        { Z: { kind: "config", default: "" }, A: { kind: "required" }, M: { kind: "optional" } },
        { A: { kind: "config", value: "x" } }
      )
    );
    expect(view.map((v) => v.key)).toEqual(["Z", "A", "M"]);
  });

  it("does not show environment keys that the schema does not declare", () => {
    const view = environmentKeyView(
      loaded(
        { A: { kind: "required" } },
        { A: { kind: "secret" }, EXTRA: { kind: "config", value: "x" } }
      )
    );
    expect(view.map((v) => v.key)).toEqual(["A"]);
  });

  it("applies !ref coordinate defaults: stage→current stage, key→consuming key name", () => {
    const view = environmentKeyView(
      loaded(
        { TOKEN: { kind: "required" } },
        { TOKEN: { kind: "ref", reference: { shelf: "supabase" } } },
        "staging"
      )
    );
    expect(view[0].reference).toEqual({ shelf: "supabase", stage: "staging", key: "TOKEN" });
  });

  it("honours explicit !ref target stage and key over the defaults", () => {
    const view = environmentKeyView(
      loaded(
        { TOKEN: { kind: "required" } },
        { TOKEN: { kind: "ref", reference: { shelf: "supabase", stage: "prod", key: "OTHER" } } },
        "staging"
      )
    );
    expect(view[0].reference).toEqual({ shelf: "supabase", stage: "prod", key: "OTHER" });
  });

  it("returns an empty array for a schema that declares no keys", () => {
    expect(environmentKeyView(loaded({}, {}))).toEqual([]);
  });

  describe("metadata (offline adapter address)", () => {
    /** A stub adapter that records every metadata() call and echoes the key/ref. */
    function stubAdapter(): Adapter & { calls: Array<{ key: string; ref?: unknown }> } {
      const calls: Array<{ key: string; ref?: unknown }> = [];
      return {
        calls,
        resolve: () => Promise.reject(new Error("must not resolve")),
        write: () => Promise.reject(new Error("must not write")),
        metadata(key, ref): AdapterMetadata {
          calls.push({ key, ref });
          return { adapter: "gcp", resource: `addr/${key}` };
        }
      };
    }

    it("attaches metadata to secret keys, passing the explicit !secret ref payload", () => {
      const adapter = stubAdapter();
      const view = environmentKeyView(
        loaded(
          { TOKEN: { kind: "required" }, OTHER: { kind: "required" } },
          {
            TOKEN: { kind: "secret" },
            OTHER: { kind: "secret", ref: { ref: "shared-name" } }
          }
        ),
        adapter
      );
      expect(view[0]).toEqual({
        key: "TOKEN",
        presence: "required",
        status: "secret",
        metadata: { adapter: "gcp", resource: "addr/TOKEN" }
      });
      expect(view[1].metadata).toEqual({ adapter: "gcp", resource: "addr/OTHER" });
      expect(adapter.calls).toEqual([
        { key: "TOKEN", ref: undefined },
        { key: "OTHER", ref: { ref: "shared-name" } }
      ]);
    });

    it("surfaces the pinned version on a secret key and passes the pinned ref to metadata (ADR-0009)", () => {
      const adapter = stubAdapter();
      const view = environmentKeyView(
        loaded(
          { TOKEN: { kind: "required" } },
          { TOKEN: { kind: "secret", ref: { version: 5 }, version: 5 } }
        ),
        adapter
      );
      expect(view[0]).toMatchObject({ key: "TOKEN", status: "secret", version: 5 });
      // The pinned payload reaches metadata so the address pins .../versions/5.
      expect(adapter.calls).toEqual([{ key: "TOKEN", ref: { version: 5 } }]);
    });

    it("omits version on a floating (bare) secret", () => {
      const adapter = stubAdapter();
      const view = environmentKeyView(
        loaded({ TOKEN: { kind: "required" } }, { TOKEN: { kind: "secret" } }),
        adapter
      );
      expect(view[0].version).toBeUndefined();
    });

    it("omits metadata for non-secret keys (config, default, ref, missing, unset)", () => {
      const adapter = stubAdapter();
      const view = environmentKeyView(
        loaded(
          {
            CFG: { kind: "config", default: "x" },
            DEF: { kind: "config", default: "x" },
            REFK: { kind: "required" },
            MISS: { kind: "required" },
            OPT: { kind: "optional" }
          },
          {
            CFG: { kind: "config", value: "y" },
            REFK: { kind: "ref", reference: { shelf: "other" } }
          }
        ),
        adapter
      );
      for (const v of view) expect(v.metadata).toBeUndefined();
      // Only secret keys are addressed — none here, so the adapter is never called.
      expect(adapter.calls).toEqual([]);
    });

    it("omits metadata when the adapter does not implement metadata()", () => {
      const adapter: Adapter = {
        resolve: () => Promise.reject(new Error("no")),
        write: () => Promise.reject(new Error("no"))
      };
      const view = environmentKeyView(
        loaded({ TOKEN: { kind: "required" } }, { TOKEN: { kind: "secret" } }),
        adapter
      );
      expect(view[0].metadata).toBeUndefined();
    });

    it("omits metadata entirely when no adapter is supplied", () => {
      const view = environmentKeyView(
        loaded({ TOKEN: { kind: "required" } }, { TOKEN: { kind: "secret" } })
      );
      expect(view[0].metadata).toBeUndefined();
    });
  });
});

describe("formatStatus", () => {
  /** An identity colorizer — the glyphless plain text, so assertions read clearly. */
  const plain: Colorize = (_color, text) => text;

  /** A tagging colorizer — proves which colour each span gets, glyph-free. */
  const tag: Colorize = (color, text) => `<${color}>${text}</${color}>`;

  function view(status: KeyView["status"], reference?: KeyView["reference"]): KeyView {
    return { key: "K", presence: "required", status, reference };
  }

  it("renders each status with its glyph + word (plain)", () => {
    expect(formatStatus(view("config"), plain)).toBe("✓ config");
    expect(formatStatus(view("secret"), plain)).toBe("✓ secret");
    expect(formatStatus(view("default"), plain)).toBe("— default");
    expect(formatStatus(view("unset"), plain)).toBe("— unset");
    expect(formatStatus(view("missing"), plain)).toBe("✗ missing");
  });

  it("renders ref with its resolved (unfollowed) target", () => {
    const ref = view("ref", { shelf: "supabase", stage: "production", key: "K" });
    expect(formatStatus(ref, plain)).toBe("✓ ref → supabase/production");
  });

  it("colours the glyph green, secret yellow, missing red, defaults/unset dim", () => {
    expect(formatStatus(view("config"), tag)).toBe("<green>✓</green> config");
    expect(formatStatus(view("secret"), tag)).toBe("<green>✓</green> <yellow>secret</yellow>");
    expect(formatStatus(view("missing"), tag)).toBe("<red>✗</red> <red>missing</red>");
    expect(formatStatus(view("default"), tag)).toBe("<dim>— default</dim>");
    expect(formatStatus(view("unset"), tag)).toBe("<dim>— unset</dim>");
  });
});
