import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { Document, parseDocument, type SchemaOptions } from "yaml";
import { stringifyString } from "yaml/util";
import type { KeyshelfSchema, TaggedValue } from "@/types";
import { isTaggedValue } from "@/types";

const SCHEMA_FILENAME = "keyshelf.yaml";

const PROVIDER_TAGS = ["age", "awssm", "gcsm"];

function buildCustomTags(): SchemaOptions["customTags"] {
  return PROVIDER_TAGS.map((name) => ({
    tag: `!${name}`,
    identify: (value: unknown) => isTaggedValue(value) && value._tag === `!${name}`,
    resolve: (str: string) => ({ _tag: `!${name}`, value: str }) as TaggedValue,
    stringify(
      item: { value: TaggedValue },
      ctx: unknown,
      onComment: unknown,
      onChompKeep: unknown
    ) {
      return stringifyString(
        { value: item.value.value } as { value: string },
        ctx as Parameters<typeof stringifyString>[1],
        onComment as Parameters<typeof stringifyString>[2],
        onChompKeep as Parameters<typeof stringifyString>[3]
      );
    }
  }));
}

const CUSTOM_TAGS = buildCustomTags();

/** Walk up from cwd looking for keyshelf.yaml */
export function findSchemaPath(from: string = process.cwd()): string {
  let dir = resolve(from);
  while (true) {
    const candidate = resolve(dir, SCHEMA_FILENAME);
    if (existsSync(candidate)) return candidate;

    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not find ${SCHEMA_FILENAME}. Run 'keyshelf init' to create one.`);
    }
    dir = parent;
  }
}

/** Parse keyshelf.yaml into a KeyshelfSchema */
export async function readSchema(filePath?: string): Promise<KeyshelfSchema> {
  const path = filePath ?? findSchemaPath();
  const content = await readFile(path, "utf-8");
  const doc = parseDocument(content, { customTags: CUSTOM_TAGS });

  if (doc.errors.length > 0) {
    throw new Error(`Invalid ${SCHEMA_FILENAME}: ${doc.errors[0].message}`);
  }

  const schema = doc.toJSON();

  if (!schema || typeof schema !== "object") {
    throw new Error(`Invalid ${SCHEMA_FILENAME}: file is empty or not a YAML mapping.`);
  }
  if (typeof schema.project !== "string" || !schema.project) {
    throw new Error(`Invalid ${SCHEMA_FILENAME}: missing or empty 'project' field.`);
  }
  if (typeof schema.keys !== "object" || schema.keys === null || Array.isArray(schema.keys)) {
    throw new Error(`Invalid ${SCHEMA_FILENAME}: missing or invalid 'keys' field.`);
  }

  return schema as KeyshelfSchema;
}

/** Stringify and write a KeyshelfSchema to disk */
export async function writeSchema(schema: KeyshelfSchema, filePath: string): Promise<void> {
  const doc = new Document(schema, { customTags: CUSTOM_TAGS });
  const yaml = doc.toString({ lineWidth: 0 });
  await writeFile(filePath, yaml, "utf-8");
}
