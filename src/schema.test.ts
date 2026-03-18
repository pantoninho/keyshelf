import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readSchema, writeSchema, findSchemaPath } from "@/schema";
import { isTaggedValue } from "@/types";
import type { KeyshelfSchema } from "@/types";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "keyshelf-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("schema round-trip", () => {
  it("writes and reads a schema with plain values", async () => {
    const schema: KeyshelfSchema = {
      project: "test-app",
      publicKey: "age1abc123",
      keys: {
        "database/url": {
          default: "postgres://localhost:5432/app",
        },
      },
    };

    const filePath = join(tempDir, "keyshelf.yaml");
    await writeSchema(schema, filePath);
    const result = await readSchema(filePath);

    expect(result).toEqual(schema);
  });

  it("writes and reads a schema with !age tagged values", async () => {
    const schema: KeyshelfSchema = {
      project: "test-app",
      publicKey: "age1abc123",
      keys: {
        "api/key": {
          default: {
            _tag: "!age",
            value:
              "-----BEGIN AGE ENCRYPTED FILE-----\nYWdlLWVuY3J5cHRpb24\n-----END AGE ENCRYPTED FILE-----\n",
          },
        },
      },
    };

    const filePath = join(tempDir, "keyshelf.yaml");
    await writeSchema(schema, filePath);
    const result = await readSchema(filePath);

    expect(result).toEqual(schema);
  });

  it("preserves mixed plain and tagged values across environments", async () => {
    const schema: KeyshelfSchema = {
      project: "test-app",
      publicKey: "age1abc123",
      keys: {
        "database/url": {
          default: "postgres://localhost:5432/app",
          staging: {
            _tag: "!age",
            value: "-----BEGIN AGE ENCRYPTED FILE-----\nenc1\n-----END AGE ENCRYPTED FILE-----\n",
          },
          prod: {
            _tag: "!age",
            value: "-----BEGIN AGE ENCRYPTED FILE-----\nenc2\n-----END AGE ENCRYPTED FILE-----\n",
          },
        },
      },
    };

    const filePath = join(tempDir, "keyshelf.yaml");
    await writeSchema(schema, filePath);
    const result = await readSchema(filePath);

    expect(result).toEqual(schema);
  });

  it("writes and reads a schema with !awssm tagged values", async () => {
    const schema: KeyshelfSchema = {
      project: "test-app",
      publicKey: "age1abc123",
      keys: {
        "database/password": {
          default: {
            _tag: "!awssm",
            value: "my-project/production/database/password",
          },
        },
      },
    };

    const filePath = join(tempDir, "keyshelf.yaml");
    await writeSchema(schema, filePath);
    const result = await readSchema(filePath);

    expect(result).toEqual(schema);

    const raw = await readFile(filePath, "utf-8");
    expect(raw).toContain("!awssm");
  });

  it("writes and reads a schema with !gcsm tagged values", async () => {
    const schema: KeyshelfSchema = {
      project: "test-app",
      publicKey: "age1abc123",
      keys: {
        "database/password": {
          default: {
            _tag: "!gcsm",
            value: "projects/my-project/secrets/database-password/versions/latest",
          },
        },
      },
    };

    const filePath = join(tempDir, "keyshelf.yaml");
    await writeSchema(schema, filePath);
    const result = await readSchema(filePath);

    expect(result).toEqual(schema);

    const raw = await readFile(filePath, "utf-8");
    expect(raw).toContain("!gcsm");
  });

  it("throws on invalid YAML content", async () => {
    const filePath = join(tempDir, "keyshelf.yaml");
    await writeFile(filePath, "project: [\ninvalid", "utf-8");

    await expect(readSchema(filePath)).rejects.toThrow("Invalid keyshelf.yaml");
  });

  it("throws when project field is missing", async () => {
    const filePath = join(tempDir, "keyshelf.yaml");
    await writeFile(filePath, "keys: {}\n", "utf-8");

    await expect(readSchema(filePath)).rejects.toThrow("missing or empty 'project'");
  });

  it("throws when keys field is missing", async () => {
    const filePath = join(tempDir, "keyshelf.yaml");
    await writeFile(filePath, "project: my-app\n", "utf-8");

    await expect(readSchema(filePath)).rejects.toThrow("missing or invalid 'keys'");
  });

  it("throws when keys field is not a mapping", async () => {
    const filePath = join(tempDir, "keyshelf.yaml");
    await writeFile(filePath, "project: my-app\nkeys:\n  - item1\n", "utf-8");

    await expect(readSchema(filePath)).rejects.toThrow("missing or invalid 'keys'");
  });

  it("produces valid YAML with !age tags in the output", async () => {
    const schema: KeyshelfSchema = {
      project: "test-app",
      keys: {
        "secret/key": {
          default: { _tag: "!age", value: "encrypted-data" },
        },
      },
    };

    const filePath = join(tempDir, "keyshelf.yaml");
    await writeSchema(schema, filePath);
    const raw = await readFile(filePath, "utf-8");

    expect(raw).toContain("!age");
  });
});

describe("isTaggedValue", () => {
  it("returns true for valid tagged value", () => {
    expect(isTaggedValue({ _tag: "!age", value: "encrypted" })).toBe(true);
  });

  it("returns false for null", () => {
    expect(isTaggedValue(null)).toBe(false);
  });

  it("returns false for a number", () => {
    expect(isTaggedValue(42)).toBe(false);
  });

  it("returns false for a plain string", () => {
    expect(isTaggedValue("hello")).toBe(false);
  });

  it("returns false when _tag is missing", () => {
    expect(isTaggedValue({ value: "encrypted" })).toBe(false);
  });

  it("returns false when value is missing", () => {
    expect(isTaggedValue({ _tag: "!age" })).toBe(false);
  });

  it("returns false when _tag is not a string", () => {
    expect(isTaggedValue({ _tag: 123, value: "encrypted" })).toBe(false);
  });

  it("returns false when value is not a string", () => {
    expect(isTaggedValue({ _tag: "!age", value: 123 })).toBe(false);
  });
});

describe("findSchemaPath", () => {
  it("finds keyshelf.yaml in the given directory", async () => {
    const schema: KeyshelfSchema = { project: "test", keys: {} };
    const filePath = join(tempDir, "keyshelf.yaml");
    await writeSchema(schema, filePath);

    const found = findSchemaPath(tempDir);
    expect(found).toBe(filePath);
  });

  it("finds keyshelf.yaml in a parent directory", async () => {
    const schema: KeyshelfSchema = { project: "test", keys: {} };
    const filePath = join(tempDir, "keyshelf.yaml");
    await writeSchema(schema, filePath);

    const { mkdirSync } = await import("node:fs");
    const nested = join(tempDir, "src", "lib");
    mkdirSync(nested, { recursive: true });

    const found = findSchemaPath(nested);
    expect(found).toBe(filePath);
  });

  it("throws when no keyshelf.yaml exists", () => {
    expect(() => findSchemaPath(tempDir)).toThrow("Could not find keyshelf.yaml");
  });
});
