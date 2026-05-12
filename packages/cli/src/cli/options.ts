import type { NormalizedConfig, NormalizedRecord } from "../config/types.js";

export function splitList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length === 0 ? undefined : parts;
}

export function findRecordOrExit(config: NormalizedConfig, keyPath: string): NormalizedRecord {
  const record = config.keys.find((entry) => entry.path === keyPath);
  if (record === undefined) {
    console.error(`error: key "${keyPath}" is not defined in keyshelf.config.ts`);
    process.exit(1);
  }
  return record;
}
