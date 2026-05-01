import yaml from "js-yaml";
import { KEYSHELF_SCHEMA, isTaggedValue } from "./yaml-tags.js";
import { flattenKeys } from "../utils/paths.js";
import { parseProviderBlock, type ProviderConfig } from "./environment.js";

export interface KeyDefinition {
  path: string;
  isSecret: boolean;
  optional: boolean;
  defaultValue?: string;
}

export interface SchemaConfig {
  name?: string;
  provider?: ProviderConfig;
}

export interface ParsedSchema {
  keys: KeyDefinition[];
  config: SchemaConfig;
}

export function parseSchema(content: string): ParsedSchema {
  const raw = yaml.load(content, { schema: KEYSHELF_SCHEMA });
  if (!raw || typeof raw !== "object") {
    throw new Error('keyshelf.yaml must contain a "keys:" block defining your keys');
  }

  const doc = raw as Record<string, unknown>;

  if (!("keys" in doc) || doc.keys == null || typeof doc.keys !== "object") {
    throw new Error('keyshelf.yaml must contain a "keys:" block defining your keys');
  }

  const provider = parseProviderBlock(doc["default-provider"]);

  let name: string | undefined;
  if ("name" in doc && doc.name !== undefined) {
    if (typeof doc.name !== "string" || doc.name === "") {
      throw new Error('keyshelf.yaml "name" must be a non-empty string');
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(doc.name)) {
      throw new Error(
        'keyshelf.yaml "name" must contain only letters, digits, hyphens, and underscores'
      );
    }
    name = doc.name;
  }

  const flat = flattenKeys(doc.keys as Record<string, unknown>);
  const definitions: KeyDefinition[] = [];

  for (const [path, value] of Object.entries(flat)) {
    if (isTaggedValue(value)) {
      definitions.push({
        path,
        isSecret: true,
        optional: value.tag === "secret" && value.config.optional === true
      });
    } else {
      if (value != null && typeof value === "object") {
        throw new Error(
          `Unexpected object value at "${path}" in schema. Use nested keys or a tag instead.`
        );
      }
      definitions.push({
        path,
        isSecret: false,
        optional: false,
        defaultValue: value == null ? undefined : String(value)
      });
    }
  }

  return { keys: definitions, config: { name, provider } };
}
