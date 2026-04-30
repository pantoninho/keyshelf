import { describe, expect, it } from "vitest";
import {
  age,
  config,
  defineConfig,
  gcp,
  normalizeConfig,
  secret,
  validateAppMappingReferences
} from "../../../src/v5/config/index.js";

describe("v5 config factories and validation", () => {
  it("normalizes nested namespaces, string paths, bare scalars, config, and secrets", () => {
    const normalized = normalizeConfig(
      defineConfig({
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
              value: age({ identityFile: "./ci.txt" })
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
        value: age({ identityFile: "./ci.txt" }),
        values: undefined
      }
    ]);
  });

  it("rejects value and default on the same record", () => {
    expect(() =>
      normalizeConfig(
        defineConfig({
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
          envs: ["dev"],
          keys: {
            token: secret({ value: age({}) })
          }
        })
      )
    ).toThrow("age provider requires identityFile or recipient");
  });

  it("rejects duplicate flattened paths", () => {
    expect(() =>
      normalizeConfig(
        defineConfig({
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
          envs: ["dev"],
          keys: {
            "db.host": "localhost"
          }
        })
      )
    ).toThrow('invalid path segment "db.host"');
  });

  it("validates template references and cycles", () => {
    expect(() =>
      normalizeConfig(
        defineConfig({
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
          envs: ["dev"],
          keys: {
            a: config({ value: "${b}" }),
            b: config({ value: "${a}" })
          }
        })
      )
    ).toThrow("template cycle detected");
  });

  it("allows templates to reference secrets and ignores escaped template markers", () => {
    const normalized = normalizeConfig(
      defineConfig({
        envs: ["dev"],
        keys: {
          token: secret({ value: gcp({ project: "my-project" }) }),
          url: config({ value: "https://x.test?token=${token}&literal=$${missing}" })
        }
      })
    );

    expect(normalized.keys.map((key) => key.path)).toEqual(["token", "url"]);
  });

  it("validates app mapping references against flattened keys", () => {
    const normalized = normalizeConfig(
      defineConfig({
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
