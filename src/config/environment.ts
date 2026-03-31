import yaml from "js-yaml";
import { KEYSHELF_SCHEMA, type TaggedValue } from "./yaml-tags.js";
import { flattenKeys } from "../utils/paths.js";

export interface ProviderConfig {
  name: string;
  options: Record<string, unknown>;
}

export interface CacheConfig {
  ttl: number;
}

export interface EnvConfig {
  defaultProvider?: ProviderConfig;
  cache?: CacheConfig;
  overrides: Record<string, string | TaggedValue>;
}

export function parseEnvironment(content: string): EnvConfig {
  const raw = yaml.load(content, { schema: KEYSHELF_SCHEMA });
  if (!raw || typeof raw !== "object") {
    return { overrides: {} };
  }

  const doc = raw as Record<string, unknown>;
  const defaultProvider = parseProviderBlock(doc["default-provider"]);
  const cache = parseCacheBlock(doc.cache);

  const keysBlock = doc.keys;
  if (keysBlock != null && typeof keysBlock !== "object") {
    throw new Error('Environment file "keys:" must be a mapping');
  }

  const source = (keysBlock as Record<string, unknown> | undefined) ?? {};
  const flat = flattenKeys(source);
  const overrides: Record<string, string | TaggedValue> = {};

  for (const [path, value] of Object.entries(flat)) {
    if (value != null) {
      overrides[path] = value as string | TaggedValue;
    }
  }

  return { defaultProvider, cache, overrides };
}

export function parseProviderBlock(raw: unknown): ProviderConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;

  const block = raw as Record<string, unknown>;
  const name = block.name;
  if (typeof name !== "string") return undefined;

  const options: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(block)) {
    if (key !== "name") {
      options[key] = value;
    }
  }

  return { name, options };
}

export function parseCacheBlock(raw: unknown): CacheConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;

  const block = raw as Record<string, unknown>;
  const ttl = block.ttl;

  if (typeof ttl !== "number" || ttl <= 0) {
    throw new Error('Cache "ttl" must be a positive number (seconds)');
  }

  return { ttl };
}
