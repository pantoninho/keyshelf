import { describe, expect, it } from "vitest";
import { FakeAdapter, inMemoryStore } from "../../src/adapters/fake.js";
import { KeyshelfError } from "../../src/errors.js";
import type { Config, Environment, LoadedEnvironment, Schema } from "../../src/model.js";
import { buildChildEnv, parseSet, resolveEnvironment } from "../../src/resolve.js";

/** A factory yielding an empty adapter for config-only cases (never invoked). */
const noSecrets = () => new FakeAdapter(inMemoryStore());

/** Wrap a concrete adapter as the lazy factory resolveEnvironment expects. */
const using = (a: FakeAdapter) => () => a;

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
