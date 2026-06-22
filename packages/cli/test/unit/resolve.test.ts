import { describe, expect, it } from "vitest";
import { FakeAdapter, inMemoryStore } from "../../src/adapters/fake.js";
import { KeyshelfError } from "../../src/errors.js";
import type { Config, Environment, LoadedEnvironment, Schema } from "../../src/model.js";
import {
  buildChildEnv,
  parseSet,
  resolveEnvironment,
  type ResolveDeps
} from "../../src/resolve.js";

/** Deps whose adapter is never invoked (config-only cases) and that load no
 * referenced environments. */
const noSecrets: ResolveDeps = {
  adapterFor: () => new FakeAdapter(inMemoryStore()),
  loadEnvironment: () => {
    throw new Error("loadEnvironment should not be called");
  }
};

/** Wrap a concrete adapter as deps whose adapterFor yields it. */
const using = (a: FakeAdapter): ResolveDeps => ({
  adapterFor: () => a,
  loadEnvironment: () => {
    throw new Error("loadEnvironment should not be called");
  }
});

const config: Config = {
  project: "myapp",
  providers: { local: { adapter: "sops" } }
};

const schema: Schema = {
  keys: {
    LOG_LEVEL: { kind: "config", default: "info" },
    REGION: { kind: "required" },
    FEATURE_X: { kind: "optional" },
    DATABASE_PASSWORD: { kind: "required" }
  }
};

function env(keys: Environment["keys"]): LoadedEnvironment {
  return {
    config,
    schema,
    environment: { shelf: "web", name: "staging", provider: "local", keys }
  };
}

describe("resolveEnvironment (config-only)", () => {
  it("merges schema defaults with environment values, environment wins", async () => {
    const map = await resolveEnvironment(
      env({
        REGION: { kind: "config", value: "eu-west-1" },
        DATABASE_PASSWORD: { kind: "config", value: "pw" },
        LOG_LEVEL: { kind: "config", value: "debug" }
      }),
      noSecrets
    );
    expect(map).toEqual({ LOG_LEVEL: "debug", REGION: "eu-west-1", DATABASE_PASSWORD: "pw" });
  });

  it("contributes a schema config default when the environment omits the key", async () => {
    const map = await resolveEnvironment(
      env({
        REGION: { kind: "config", value: "eu" },
        DATABASE_PASSWORD: { kind: "config", value: "pw" }
      }),
      noSecrets
    );
    expect(map.LOG_LEVEL).toBe("info");
  });

  it("omits optional and absent keys that have no default", async () => {
    const map = await resolveEnvironment(
      env({
        REGION: { kind: "config", value: "eu" },
        DATABASE_PASSWORD: { kind: "config", value: "pw" }
      }),
      noSecrets
    );
    expect(Object.prototype.hasOwnProperty.call(map, "FEATURE_X")).toBe(false);
  });

  it("preserves byte-exact values including whitespace and empty strings", async () => {
    const map = await resolveEnvironment(
      env({
        REGION: { kind: "config", value: " eu = west \n" },
        DATABASE_PASSWORD: { kind: "config", value: "" }
      }),
      noSecrets
    );
    expect(map.REGION).toBe(" eu = west \n");
    expect(map.DATABASE_PASSWORD).toBe("");
  });
});

describe("resolveEnvironment (secret resolution)", () => {
  it("resolves a !secret through the adapter by convention (key name)", async () => {
    const adapter = new FakeAdapter(inMemoryStore());
    await adapter.write("DATABASE_PASSWORD", "s3cr3t");
    const map = await resolveEnvironment(
      env({ REGION: { kind: "config", value: "eu" }, DATABASE_PASSWORD: { kind: "secret" } }),
      using(adapter)
    );
    expect(map.DATABASE_PASSWORD).toBe("s3cr3t");
    expect(map.REGION).toBe("eu");
  });

  it("resolves a differently-named foreign value via an explicit { ref }", async () => {
    const adapter = new FakeAdapter(inMemoryStore({ "shared-db-url": "postgres://x" }));
    const map = await resolveEnvironment(
      env({
        REGION: { kind: "config", value: "eu" },
        DATABASE_PASSWORD: { kind: "secret", ref: { ref: "shared-db-url" } }
      }),
      using(adapter)
    );
    expect(map.DATABASE_PASSWORD).toBe("postgres://x");
  });

  it("fails with SECRET_NOT_FOUND when no value is stored for a !secret", async () => {
    const adapter = new FakeAdapter(inMemoryStore());
    let thrown: unknown;
    try {
      await resolveEnvironment(
        env({ REGION: { kind: "config", value: "eu" }, DATABASE_PASSWORD: { kind: "secret" } }),
        using(adapter)
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(KeyshelfError);
    expect((thrown as KeyshelfError).code).toBe("SECRET_NOT_FOUND");
    expect((thrown as KeyshelfError).fields).toMatchObject({ key: "DATABASE_PASSWORD" });
  });
});

describe("resolveEnvironment (key references)", () => {
  /** A target shelf 'shared' with its own schema, environment, and provider. */
  function sharedEnv(keys: Environment["keys"], stage = "staging"): LoadedEnvironment {
    return {
      config,
      schema: {
        keys: {
          DATABASE_PASSWORD: { kind: "required" },
          SHARED_DB: { kind: "required" },
          AUDIT_KEY: { kind: "required" },
          LOG_LEVEL: { kind: "config", default: "shared-default" }
        }
      },
      environment: { shelf: "shared", name: stage, provider: "shared-provider", keys }
    };
  }

  /** Deps that route each adapter request to a per-shelf adapter, and serve a
   * fixed set of target environments by `{shelf}/{stage}`. */
  function deps(opts: {
    adapters: Record<string, FakeAdapter>;
    targets: Record<string, LoadedEnvironment>;
  }): ResolveDeps {
    return {
      adapterFor: (loaded) => {
        const a = opts.adapters[loaded.environment.shelf];
        if (a === undefined) throw new Error(`no adapter for shelf ${loaded.environment.shelf}`);
        return a;
      },
      loadEnvironment: async (shelf, stage) => {
        const target = opts.targets[`${shelf}/${stage}`];
        if (target === undefined) {
          throw new KeyshelfError("ENVIRONMENT_NOT_FOUND", `missing ${shelf}/${stage}`, {
            shelf,
            environment: `${shelf}/${stage}`
          });
        }
        return target;
      }
    };
  }

  it("resolves a !ref to a plaintext config in the target shelf, same key name", async () => {
    const map = await resolveEnvironment(
      env({
        REGION: { kind: "config", value: "eu" },
        DATABASE_PASSWORD: { kind: "ref", reference: { shelf: "shared" } }
      }),
      deps({
        adapters: {},
        targets: {
          "shared/staging": sharedEnv({ DATABASE_PASSWORD: { kind: "config", value: "shared-pw" } })
        }
      })
    );
    expect(map.DATABASE_PASSWORD).toBe("shared-pw");
  });

  it("resolves a !ref to a secret through the TARGET environment's provider", async () => {
    const sharedAdapter = new FakeAdapter(inMemoryStore());
    await sharedAdapter.write("DATABASE_PASSWORD", "from-shared-store");
    const consumingAdapter = new FakeAdapter(inMemoryStore()); // must NOT be used

    const map = await resolveEnvironment(
      env({
        DATABASE_PASSWORD: { kind: "ref", reference: { shelf: "shared" } }
      }),
      deps({
        adapters: { shared: sharedAdapter, web: consumingAdapter },
        targets: {
          "shared/staging": sharedEnv({ DATABASE_PASSWORD: { kind: "secret" } })
        }
      })
    );
    expect(map.DATABASE_PASSWORD).toBe("from-shared-store");
  });

  it("renames: a consuming key resolves a differently-named target key via key:", async () => {
    const sharedAdapter = new FakeAdapter(inMemoryStore());
    await sharedAdapter.write("SHARED_DB", "renamed-value");

    const map = await resolveEnvironment(
      env({
        DATABASE_PASSWORD: { kind: "ref", reference: { shelf: "shared", key: "SHARED_DB" } }
      }),
      deps({
        adapters: { shared: sharedAdapter },
        targets: {
          "shared/staging": sharedEnv({ SHARED_DB: { kind: "secret" } })
        }
      })
    );
    expect(map.DATABASE_PASSWORD).toBe("renamed-value");
  });

  it("crosses stages: stage: resolves the target at a different stage", async () => {
    const map = await resolveEnvironment(
      env({
        AUDIT_KEY: { kind: "ref", reference: { shelf: "shared", stage: "production" } }
      }),
      deps({
        adapters: {},
        targets: {
          "shared/production": sharedEnv(
            { AUDIT_KEY: { kind: "config", value: "prod-audit" } },
            "production"
          )
        }
      })
    );
    expect(map.AUDIT_KEY).toBe("prod-audit");
  });

  it("resolves a !ref onto a target schema config default (no env override)", async () => {
    const map = await resolveEnvironment(
      env({
        LOG_LEVEL: { kind: "ref", reference: { shelf: "shared" } }
      }),
      deps({
        adapters: {},
        targets: { "shared/staging": sharedEnv({}) }
      })
    );
    expect(map.LOG_LEVEL).toBe("shared-default");
  });

  it("fails INVALID_REFERENCE when the target is itself a !ref (one hop only)", async () => {
    let thrown: unknown;
    try {
      await resolveEnvironment(
        env({ DATABASE_PASSWORD: { kind: "ref", reference: { shelf: "shared" } } }),
        deps({
          adapters: {},
          targets: {
            "shared/staging": sharedEnv({
              DATABASE_PASSWORD: { kind: "ref", reference: { shelf: "other" } }
            })
          }
        })
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(KeyshelfError);
    expect((thrown as KeyshelfError).code).toBe("INVALID_REFERENCE");
  });

  it("fails REFERENCE_NOT_FOUND when the target key is absent from the target environment", async () => {
    let thrown: unknown;
    try {
      await resolveEnvironment(
        env({ DATABASE_PASSWORD: { kind: "ref", reference: { shelf: "shared" } } }),
        deps({
          adapters: {},
          targets: { "shared/staging": sharedEnv({}) }
        })
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(KeyshelfError);
    expect((thrown as KeyshelfError).code).toBe("REFERENCE_NOT_FOUND");
  });

  it("fails REFERENCE_NOT_FOUND when the target shelf/stage does not exist", async () => {
    let thrown: unknown;
    try {
      await resolveEnvironment(
        env({ DATABASE_PASSWORD: { kind: "ref", reference: { shelf: "nope" } } }),
        deps({ adapters: {}, targets: {} })
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(KeyshelfError);
    expect((thrown as KeyshelfError).code).toBe("REFERENCE_NOT_FOUND");
  });
});

describe("parseSet", () => {
  it("splits KEY=VALUE on the first =", () => {
    expect(parseSet("FOO=bar")).toEqual({ key: "FOO", value: "bar" });
  });

  it("keeps later = signs in the value verbatim", () => {
    expect(parseSet("URL=postgres://h?a=b=c")).toEqual({ key: "URL", value: "postgres://h?a=b=c" });
  });

  it("allows an empty value", () => {
    expect(parseSet("EMPTY=")).toEqual({ key: "EMPTY", value: "" });
  });

  it("rejects a --set without = with MALFORMED_FILE", () => {
    let thrown: unknown;
    try {
      parseSet("NOEQUALS");
    } catch (error) {
      thrown = error;
    }

    expect((thrown as KeyshelfError).code).toBe("MALFORMED_FILE");
  });

  it("rejects an invalid key name with INVALID_KEY_NAME", () => {
    let thrown: unknown;
    try {
      parseSet("bad-key=x");
    } catch (error) {
      thrown = error;
    }

    expect((thrown as KeyshelfError).code).toBe("INVALID_KEY_NAME");
  });
});

describe("buildChildEnv precedence", () => {
  const managed = { LOG_LEVEL: "debug", REGION: "eu" };

  it("overlays managed values onto the inherited ambient environment", () => {
    const out = buildChildEnv({ ambient: { PATH: "/bin", HOME: "/root" }, managed, sets: {} });
    expect(out).toMatchObject({ PATH: "/bin", HOME: "/root", LOG_LEVEL: "debug", REGION: "eu" });
  });

  it("overrides a stale ambient value for a managed key (managed wins)", () => {
    const out = buildChildEnv({ ambient: { REGION: "STALE", PATH: "/bin" }, managed, sets: {} });
    expect(out.REGION).toBe("eu");
    expect(out.PATH).toBe("/bin");
  });

  it("lets --set win over the resolved managed value and over ambient", () => {
    const out = buildChildEnv({
      ambient: { REGION: "STALE" },
      managed,
      sets: { REGION: "override" }
    });
    expect(out.REGION).toBe("override");
  });

  it("lets --set introduce a key keyshelf does not manage", () => {
    const out = buildChildEnv({ ambient: {}, managed, sets: { EXTRA: "x" } });
    expect(out.EXTRA).toBe("x");
  });
});
