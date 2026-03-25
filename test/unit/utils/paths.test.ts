import { describe, it, expect } from "vitest";
import { flattenKeys, setNestedValue } from "../../../src/utils/paths.js";

describe("flattenKeys", () => {
  it("flattens nested objects to /-separated paths", () => {
    const input = {
      db: {
        host: "localhost",
        port: 5432
      }
    };
    expect(flattenKeys(input)).toEqual({
      "db/host": "localhost",
      "db/port": 5432
    });
  });

  it("passes through already-flat keys", () => {
    const input = { "db/host": "localhost", "db/port": 5432 };
    expect(flattenKeys(input)).toEqual({
      "db/host": "localhost",
      "db/port": 5432
    });
  });

  it("handles mixed flat and nested keys", () => {
    const input = {
      "flat/key": "value1",
      nested: { key: "value2" }
    };
    expect(flattenKeys(input)).toEqual({
      "flat/key": "value1",
      "nested/key": "value2"
    });
  });

  it("handles deeply nested objects", () => {
    const input = { a: { b: { c: "deep" } } };
    expect(flattenKeys(input)).toEqual({ "a/b/c": "deep" });
  });

  it("preserves tagged values without flattening them", () => {
    const input = {
      key: { tag: "secret", config: {} }
    };
    expect(flattenKeys(input)).toEqual({
      key: { tag: "secret", config: {} }
    });
  });

  it("returns empty object for empty input", () => {
    expect(flattenKeys({})).toEqual({});
  });

  it("preserves null and undefined values", () => {
    const input = { a: null, b: undefined };
    expect(flattenKeys(input)).toEqual({ a: null, b: undefined });
  });

  it("preserves arrays without flattening", () => {
    const input = { tags: ["a", "b"] };
    expect(flattenKeys(input)).toEqual({ tags: ["a", "b"] });
  });
});

describe("setNestedValue", () => {
  it("sets a top-level key", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "key", "value");
    expect(obj).toEqual({ key: "value" });
  });

  it("sets a nested key", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "db/host", "localhost");
    expect(obj).toEqual({ db: { host: "localhost" } });
  });

  it("sets a deeply nested key", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "a/b/c", "deep");
    expect(obj).toEqual({ a: { b: { c: "deep" } } });
  });

  it("preserves existing sibling keys", () => {
    const obj: Record<string, unknown> = { db: { host: "localhost" } };
    setNestedValue(obj, "db/port", "5432");
    expect(obj).toEqual({ db: { host: "localhost", port: "5432" } });
  });

  it("overwrites existing value", () => {
    const obj: Record<string, unknown> = { db: { host: "old" } };
    setNestedValue(obj, "db/host", "new");
    expect(obj).toEqual({ db: { host: "new" } });
  });

  it("overwrites non-object intermediate with object", () => {
    const obj: Record<string, unknown> = { db: "scalar" };
    setNestedValue(obj, "db/host", "localhost");
    expect(obj).toEqual({ db: { host: "localhost" } });
  });
});
