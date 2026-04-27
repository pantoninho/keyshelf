import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import { KEYSHELF_SCHEMA, isTaggedValue, TaggedValue } from "../../../src/config/yaml-tags.js";

describe("YAML custom tags", () => {
  const tags = ["secret", "gcp", "aws", "age"] as const;

  for (const tag of tags) {
    describe(`!${tag}`, () => {
      it("parses bare tag", () => {
        const doc = yaml.load(`key: !${tag} ""`, {
          schema: KEYSHELF_SCHEMA
        }) as Record<string, TaggedValue>;
        expect(doc.key).toEqual({ tag, config: {} });
      });

      it("parses mapping tag", () => {
        const input = `key: !${tag}\n  name: custom\n  project: my-proj`;
        const doc = yaml.load(input, { schema: KEYSHELF_SCHEMA }) as Record<string, TaggedValue>;
        expect(doc.key).toEqual({
          tag,
          config: { name: "custom", project: "my-proj" }
        });
      });

      it("parses mapping tag with empty config", () => {
        const input = `key: !${tag} {}`;
        const doc = yaml.load(input, { schema: KEYSHELF_SCHEMA }) as Record<string, TaggedValue>;
        expect(doc.key).toEqual({ tag, config: {} });
      });
    });
  }

  it("parses mixed tagged and plain values", () => {
    const input = [
      "db_host: localhost",
      'db_password: !secret ""',
      "api_key: !gcp",
      "  name: my-key"
    ].join("\n");

    const doc = yaml.load(input, { schema: KEYSHELF_SCHEMA }) as Record<string, unknown>;
    expect(doc.db_host).toBe("localhost");
    expect(doc.db_password).toEqual({ tag: "secret", config: {} });
    expect(doc.api_key).toEqual({ tag: "gcp", config: { name: "my-key" } });
  });
});

describe("isTaggedValue", () => {
  it("returns true for tagged values", () => {
    expect(isTaggedValue({ tag: "secret", config: {} })).toBe(true);
  });

  it("returns false for plain objects", () => {
    expect(isTaggedValue({ foo: "bar" })).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isTaggedValue("hello")).toBe(false);
    expect(isTaggedValue(42)).toBe(false);
    expect(isTaggedValue(null)).toBe(false);
  });
});
