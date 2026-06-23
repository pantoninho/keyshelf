import { describe, expect, it } from "vitest";
import { environmentKeyView, type KeyView } from "../../src/env-view.js";
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
});
