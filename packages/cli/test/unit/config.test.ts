import { describe, expect, it } from "vitest";
import {
  age,
  aws,
  config,
  defineConfig,
  gcp,
  normalizeConfig,
  providerRefSchema,
  secret,
  validateAppMappingReferences
} from "../../src/config/index.js";

describe("config factories and validation", () => {
  it("normalizes nested namespaces, string paths, bare scalars, config, and secrets", () => {
    const normalized = normalizeConfig(
      defineConfig({
        name: "test",
        envs: ["dev", "production"],
        groups: ["app", "ci"],
        keys: {
          log: {
            level: "info"
          },
          "db/host": config({
            group: "app",
            default: "localhost",
            values: { production: "db.example.com" }
          }),
          github: {
            token: secret({
              group: "ci",
              value: age({ identityFile: "./ci.txt", secretsDir: "./secrets" })
            })
          }
        }
      })
    );

    expect(normalized.keys).toEqual([
      { path: "log/level", kind: "config", optional: false, value: "info" },
      {
        path: "db/host",
        kind: "config",
        group: "app",
        optional: false,
        description: undefined,
        value: "localhost",
        values: { production: "db.example.com" }
      },
      {
        path: "github/token",
        kind: "secret",
        group: "ci",
        optional: false,
        description: undefined,
        value: age({ identityFile: "./ci.txt", secretsDir: "./secrets" }),
        values: undefined
      }
    ]);
  });

  it("rejects value and default on the same record", () => {
    expect(() =>
      normalizeConfig(
        defineConfig({
          name: "test",
          envs: ["dev"],
          keys: {
            host: config({ value: "localhost", default: "127.0.0.1" })
          }
        })
      )
    ).toThrow("value and default are mutually exclusive");
  });

  it("rejects undeclared env values and groups", () => {
    expect(() =>
      normalizeConfig(
        defineConfig({
          name: "test",
          envs: ["dev"],
          groups: ["app"],
          keys: {
            host: config({
              group: "ci",
              values: { production: "db.example.com" }
            })
          }
        })
      )
    ).toThrow(/group "ci" is not declared[\s\S]*undeclared env "production"/);
  });

  it("rejects empty secrets", () => {
    expect(() =>
      normalizeConfig(
        defineConfig({
          name: "test",
          envs: ["dev"],
          keys: {
            token: secret({})
          }
        })
      )
    ).toThrow("secret requires value, default, or at least one values entry");
  });

  it("rejects empty key trees and namespaces", () => {
    expect(() =>
      normalizeConfig({
        __kind: "keyshelf:config",
        envs: ["dev"],
        keys: {}
      })
    ).toThrow("keys must contain at least one entry");

    expect(() =>
      normalizeConfig(
        defineConfig({
          name: "test",
          envs: ["dev"],
          keys: {
            db: {}
          }
        })
      )
    ).toThrow("key namespaces must not be empty");
  });

  it("rejects invalid provider options", () => {
    expect(() =>
      normalizeConfig(
        defineConfig({
          name: "test",
          envs: ["dev"],
          keys: {
            // @ts-expect-error secretsDir is required
            token: secret({ value: age({ identityFile: "./ci.txt" }) })
          }
        })
      )
    ).toThrow(/factory objects with __kind must match their declared schema/);
  });

  it("rejects duplicate flattened paths", () => {
    expect(() =>
      normalizeConfig(
        defineConfig({
          name: "test",
          envs: ["dev"],
          keys: {
            db: { host: "localhost" },
            "db/host": "127.0.0.1"
          }
        })
      )
    ).toThrow("duplicate flattened path");
  });

  it("rejects leaf paths that are namespace prefixes", () => {
    expect(() =>
      normalizeConfig(
        defineConfig({
          name: "test",
          envs: ["dev"],
          keys: {
            db: "localhost",
            "db/host": "localhost"
          }
        })
      )
    ).toThrow('conflicts with leaf path "db"');
  });

  it("rejects invalid path segments", () => {
    expect(() =>
      normalizeConfig(
        defineConfig({
          name: "test",
          envs: ["dev"],
          keys: {
            "db.host": "localhost"
          }
        })
      )
    ).toThrow('invalid path segment "db.host"');
  });

  it("rejects underscore in path segments (reserved by per-provider storage ids)", () => {
    expect(() =>
      normalizeConfig(
        defineConfig({
          name: "test",
          envs: ["dev"],
          keys: {
            db_host: "localhost"
          }
        })
      )
    ).toThrow('invalid path segment "db_host"');

    expect(() =>
      normalizeConfig(
        defineConfig({
          name: "test",
          envs: ["dev"],
          keys: {
            _leading: "x"
          }
        })
      )
    ).toThrow('invalid path segment "_leading"');
  });

  it("validates template references and cycles", () => {
    expect(() =>
      normalizeConfig(
        defineConfig({
          name: "test",
          envs: ["dev"],
          keys: {
            db: {
              url: config({ value: "postgres://${db/missing}" })
            }
          }
        })
      )
    ).toThrow('template references unknown key "db/missing"');

    expect(() =>
      normalizeConfig(
        defineConfig({
          name: "test",
          envs: ["dev", "production"],
          keys: {
            db: {
              host: "localhost",
              url: config({
                values: { production: "postgres://${db/host}/${db/typo}" }
              })
            }
          }
        })
      )
    ).toThrow('template references unknown key "db/typo"');

    expect(() =>
      normalizeConfig(
        defineConfig({
          name: "test",
          envs: ["dev"],
          keys: {
            a: config({ value: "${b}" }),
            b: config({ value: "${a}" })
          }
        })
      )
    ).toThrow("template cycle detected");

    expect(() =>
      normalizeConfig(
        defineConfig({
          name: "test",
          envs: ["dev", "production"],
          keys: {
            a: config({ values: { production: "${b}" } }),
            b: config({ values: { production: "${a}" } })
          }
        })
      )
    ).toThrow("template cycle detected");
  });

  it("allows templates to reference secrets and ignores escaped template markers", () => {
    const normalized = normalizeConfig(
      defineConfig({
        name: "test",
        envs: ["dev"],
        keys: {
          token: secret({ value: gcp({ project: "my-project" }) }),
          url: config({ value: "https://x.test?token=${token}&literal=$${missing}" })
        }
      })
    );

    expect(normalized.keys.map((key) => key.path)).toEqual(["token", "url"]);
  });

  it("normalizes movedFrom into a string array on config and secret records", () => {
    const normalized = normalizeConfig(
      defineConfig({
        name: "test",
        envs: ["dev"],
        keys: {
          host: config({ value: "localhost", movedFrom: "old/host" }),
          token: secret({
            value: gcp({ project: "my-project" }),
            movedFrom: ["very-old/token", "old/token"]
          })
        }
      })
    );

    const host = normalized.keys.find((k) => k.path === "host");
    const token = normalized.keys.find((k) => k.path === "token");
    expect(host?.movedFrom).toEqual(["old/host"]);
    expect(token?.movedFrom).toEqual(["very-old/token", "old/token"]);
  });

  it("rejects movedFrom that collides with a declared key path", () => {
    expect(() =>
      normalizeConfig(
        defineConfig({
          name: "test",
          envs: ["dev"],
          keys: {
            "old/host": "localhost",
            host: config({ value: "localhost", movedFrom: "old/host" })
          }
        })
      )
    ).toThrow('movedFrom "old/host" collides with a declared key path');
  });

  it("rejects movedFrom that references the record's own path", () => {
    expect(() =>
      normalizeConfig(
        defineConfig({
          name: "test",
          envs: ["dev"],
          keys: {
            host: config({ value: "localhost", movedFrom: "host" })
          }
        })
      )
    ).toThrow("movedFrom cannot reference itself");
  });

  it("validates app mapping references against flattened keys", () => {
    const normalized = normalizeConfig(
      defineConfig({
        name: "test",
        envs: ["dev"],
        keys: {
          db: { host: "localhost" }
        }
      })
    );

    expect(() =>
      validateAppMappingReferences(
        [
          {
            envVar: "DB_URL",
            template: "postgres://${db/host}/${db/password}",
            keyPaths: ["db/host", "db/password"]
          }
        ],
        normalized.keys
      )
    ).toThrow('DB_URL: references unknown key "db/password"');

    expect(() =>
      validateAppMappingReferences(
        [{ envVar: "DB_PASSWORD", keyPath: "db/password" }],
        normalized.keys
      )
    ).toThrow('DB_PASSWORD: references unknown key "db/password"');
  });
});

describe("aws() factory", () => {
  it("returns a provider ref with empty options when called bare", () => {
    expect(aws()).toEqual({ __kind: "provider:aws", name: "aws", options: {} });
  });

  it("preserves region and kmsKeyId when provided", () => {
    const ref = aws({ region: "eu-west-1", kmsKeyId: "alias/keyshelf" });
    expect(ref.options).toEqual({ region: "eu-west-1", kmsKeyId: "alias/keyshelf" });
  });

  it("normalizes through the full config pipeline", () => {
    const normalized = normalizeConfig(
      defineConfig({
        name: "test",
        envs: ["prod"],
        keys: {
          token: secret({ value: aws({ region: "us-east-1" }) })
        }
      })
    );
    const token = normalized.keys.find((k) => k.path === "token");
    expect(token).toMatchObject({
      kind: "secret",
      value: { __kind: "provider:aws", name: "aws", options: { region: "us-east-1" } }
    });
  });
});

describe("aws provider schema", () => {
  it("accepts a ref with no options (relies on SDK region chain)", () => {
    expect(() => providerRefSchema.parse(aws())).not.toThrow();
  });

  it("accepts a ref with explicit region", () => {
    expect(() => providerRefSchema.parse(aws({ region: "eu-west-2" }))).not.toThrow();
  });

  it("accepts a ref with kmsKeyId", () => {
    expect(() =>
      providerRefSchema.parse(aws({ region: "eu-west-2", kmsKeyId: "alias/x" }))
    ).not.toThrow();
  });

  it("rejects unknown option keys (strict mode)", () => {
    expect(() =>
      providerRefSchema.parse({
        __kind: "provider:aws",
        name: "aws",
        options: { region: "eu-west-1", bogus: true }
      })
    ).toThrow();
  });

  it("rejects empty-string region", () => {
    expect(() =>
      providerRefSchema.parse({
        __kind: "provider:aws",
        name: "aws",
        options: { region: "" }
      })
    ).toThrow();
  });
});
