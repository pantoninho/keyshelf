import { describe, expect, it } from "vitest";
import { KeyshelfError } from "../../src/errors.js";
import type { Config, Environment, LoadedEnvironment, Schema } from "../../src/model.js";
import { validateEnvironment, validateReferences } from "../../src/validate.js";
import type { ReferenceValidationDeps } from "../../src/validate.js";

/**
 * Static, offline validation of key references (`!ref`) — ADR-0007, issue #203.
 * These checks reach across shelves by loading the target shelf's schema and
 * environment from the filesystem, but never touch any backend/adapter. The deps
 * here are pure: a fixed map of loaded target environments by `{shelf}/{stage}`,
 * with no adapter at all — so "no backend access" is structural.
 */

const config: Config = {
  project: "myapp",
  providers: { local: { adapter: "sops" } }
};

/** The consuming shelf 'web' and its schema. */
const schema: Schema = {
  keys: {
    REGION: { kind: "config", default: "eu" },
    DATABASE_PASSWORD: { kind: "required" },
    API_TOKEN: { kind: "optional" }
  }
};

function env(keys: Environment["keys"], overrides: Partial<Environment> = {}): LoadedEnvironment {
  return {
    config,
    schema,
    environment: { shelf: "web", name: "staging", provider: "local", keys, ...overrides }
  };
}

/** A target environment in some other shelf, with its own schema. */
function target(opts: {
  shelf?: string;
  stage?: string;
  schemaKeys: Schema["keys"];
  envKeys: Environment["keys"];
}): LoadedEnvironment {
  const shelf = opts.shelf ?? "shared";
  const stage = opts.stage ?? "staging";
  return {
    config,
    schema: { keys: opts.schemaKeys },
    environment: { shelf, name: stage, provider: "local", keys: opts.envKeys }
  };
}

/** Filesystem-only deps: serve target environments from a fixed map; a missing
 * one throws the same load error the real loader would (SHELF/ENVIRONMENT_NOT_FOUND). */
function deps(
  targets: Record<string, LoadedEnvironment>,
  missingCode: KeyshelfError["code"] = "SHELF_NOT_FOUND"
): ReferenceValidationDeps {
  return {
    loadReference: async (shelf, stage) => {
      const found = targets[`${shelf}/${stage}`];
      if (found === undefined) {
        throw new KeyshelfError(missingCode, `missing ${shelf}/${stage}`, {
          shelf,
          environment: `${shelf}/${stage}`
        });
      }
      return found;
    }
  };
}

async function expectCode(p: Promise<unknown>, code: string): Promise<KeyshelfError> {
  let thrown: unknown;
  try {
    await p;
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(KeyshelfError);
  expect((thrown as KeyshelfError).code).toBe(code);
  return thrown as KeyshelfError;
}

describe("validateReferences (static, offline)", () => {
  it("passes when the target shelf/stage/key exist, are present, and land on config", async () => {
    const loaded = env({ DATABASE_PASSWORD: { kind: "ref", reference: { shelf: "shared" } } });
    const d = deps({
      "shared/staging": target({
        schemaKeys: { DATABASE_PASSWORD: { kind: "required" } },
        envKeys: { DATABASE_PASSWORD: { kind: "config", value: "x" } }
      })
    });
    await expect(validateReferences(loaded, d)).resolves.toBeUndefined();
  });

  it("passes when the target lands on a secret (confirmed, never resolved)", async () => {
    const loaded = env({ DATABASE_PASSWORD: { kind: "ref", reference: { shelf: "shared" } } });
    const d = deps({
      "shared/staging": target({
        schemaKeys: { DATABASE_PASSWORD: { kind: "required" } },
        envKeys: { DATABASE_PASSWORD: { kind: "secret" } }
      })
    });
    await expect(validateReferences(loaded, d)).resolves.toBeUndefined();
  });

  it("ignores non-ref keys (config and secret are not checked here)", async () => {
    const loaded = env({
      REGION: { kind: "config", value: "us" },
      DATABASE_PASSWORD: { kind: "secret" }
    });
    // No ref keys ⇒ no target loads needed; deps that always throw must not be hit.
    await expect(validateReferences(loaded, deps({})).then(() => "ok")).resolves.toBe("ok");
  });

  // Check 2: target shelf exists.
  it("fails REFERENCE_NOT_FOUND when the target shelf does not exist", async () => {
    const loaded = env({ DATABASE_PASSWORD: { kind: "ref", reference: { shelf: "ghost" } } });
    await expectCode(validateReferences(loaded, deps({})), "REFERENCE_NOT_FOUND");
  });

  // Check 3: target stage exists.
  it("fails REFERENCE_NOT_FOUND when the target stage does not exist", async () => {
    const loaded = env({
      DATABASE_PASSWORD: { kind: "ref", reference: { shelf: "shared", stage: "prod" } }
    });
    // Only shared/staging exists; shared/prod is missing.
    const d = deps(
      {
        "shared/staging": target({
          schemaKeys: { DATABASE_PASSWORD: { kind: "required" } },
          envKeys: { DATABASE_PASSWORD: { kind: "secret" } }
        })
      },
      "ENVIRONMENT_NOT_FOUND"
    );
    await expectCode(validateReferences(loaded, d), "REFERENCE_NOT_FOUND");
  });

  // Check 4: target key declared in target schema.
  it("fails REFERENCE_NOT_FOUND when the target key is not declared in the target schema", async () => {
    const loaded = env({
      DATABASE_PASSWORD: { kind: "ref", reference: { shelf: "shared", key: "NOPE" } }
    });
    const d = deps({
      "shared/staging": target({
        schemaKeys: { DATABASE_PASSWORD: { kind: "required" } },
        envKeys: { DATABASE_PASSWORD: { kind: "secret" } }
      })
    });
    await expectCode(validateReferences(loaded, d), "REFERENCE_NOT_FOUND");
  });

  // Check 5: target key present in target environment (no value, no default).
  it("fails REFERENCE_NOT_FOUND when the target key is declared but unsupplied", async () => {
    const loaded = env({ DATABASE_PASSWORD: { kind: "ref", reference: { shelf: "shared" } } });
    const d = deps({
      // Declared !required in the target schema, but no env value and no default.
      "shared/staging": target({
        schemaKeys: { DATABASE_PASSWORD: { kind: "required" } },
        envKeys: {}
      })
    });
    await expectCode(validateReferences(loaded, d), "REFERENCE_NOT_FOUND");
  });

  it("passes when the target key is covered by a schema config default (no env value)", async () => {
    const loaded = env({ DATABASE_PASSWORD: { kind: "ref", reference: { shelf: "shared" } } });
    const d = deps({
      "shared/staging": target({
        schemaKeys: { DATABASE_PASSWORD: { kind: "config", default: "from-default" } },
        envKeys: {}
      })
    });
    await expect(validateReferences(loaded, d)).resolves.toBeUndefined();
  });

  // Check 6: one hop only — target is itself a !ref.
  it("fails INVALID_REFERENCE when the target is itself a !ref (one hop only)", async () => {
    const loaded = env({ DATABASE_PASSWORD: { kind: "ref", reference: { shelf: "shared" } } });
    const d = deps({
      "shared/staging": target({
        schemaKeys: { DATABASE_PASSWORD: { kind: "required" } },
        envKeys: { DATABASE_PASSWORD: { kind: "ref", reference: { shelf: "other" } } }
      })
    });
    await expectCode(validateReferences(loaded, d), "INVALID_REFERENCE");
  });

  it("applies the key default: same-name target key when key is omitted", async () => {
    const loaded = env({
      DATABASE_PASSWORD: { kind: "ref", reference: { shelf: "shared", key: "RENAMED" } }
    });
    const d = deps({
      "shared/staging": target({
        schemaKeys: { RENAMED: { kind: "required" } },
        envKeys: { RENAMED: { kind: "secret" } }
      })
    });
    await expect(validateReferences(loaded, d)).resolves.toBeUndefined();
  });

  it("applies the stage default: cross-stage reference loads the named stage", async () => {
    const loaded = env({
      DATABASE_PASSWORD: { kind: "ref", reference: { shelf: "shared", stage: "production" } }
    });
    const d = deps({
      "shared/production": target({
        stage: "production",
        schemaKeys: { DATABASE_PASSWORD: { kind: "required" } },
        envKeys: { DATABASE_PASSWORD: { kind: "secret" } }
      })
    });
    await expect(validateReferences(loaded, d)).resolves.toBeUndefined();
  });

  it("fails INVALID_REFERENCE on a structurally malformed ref (no reference payload)", async () => {
    const loaded = env({ DATABASE_PASSWORD: { kind: "ref" } });
    await expectCode(validateReferences(loaded, deps({})), "INVALID_REFERENCE");
  });
});

describe("validateEnvironment: !ref discharges !required (check 1)", () => {
  it("treats a !ref value as satisfying a !required key", () => {
    const loaded = env({ DATABASE_PASSWORD: { kind: "ref", reference: { shelf: "shared" } } });
    expect(() => validateEnvironment(loaded)).not.toThrow();
  });

  it("still rejects a !ref on a key not declared in the consuming schema (UNKNOWN_KEY)", () => {
    const loaded = env({
      DATABASE_PASSWORD: { kind: "secret" },
      EXTRA: { kind: "ref", reference: { shelf: "shared" } }
    });
    let thrown: unknown;
    try {
      validateEnvironment(loaded);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as KeyshelfError).code).toBe("UNKNOWN_KEY");
  });
});
