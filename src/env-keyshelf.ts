import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";

const ENV_KEYSHELF_FILENAME = ".env.keyshelf";

/** Walk up from `from` looking for `.env.keyshelf`. Returns path or `null`. */
export function findEnvKeyshelfPath(from: string = process.cwd()): string | null {
  let dir = resolve(from);
  while (true) {
    const candidate = resolve(dir, ENV_KEYSHELF_FILENAME);
    if (existsSync(candidate)) return candidate;

    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Parse `.env.keyshelf` content into `{ ENV_VAR: "key.path" }`. */
export function parseEnvKeyshelf(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [i, raw] of content.split("\n").entries()) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const lineNumber = i + 1;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      throw new Error(`Malformed line ${lineNumber} in .env.keyshelf: missing '='`);
    }

    const envVar = trimmed.slice(0, eqIndex).trim();
    const keyPath = trimmed.slice(eqIndex + 1).trim();

    if (!envVar) {
      throw new Error(`Malformed line ${lineNumber} in .env.keyshelf: empty env var name`);
    }
    if (!keyPath) {
      throw new Error(`Malformed line ${lineNumber} in .env.keyshelf: empty key path`);
    }

    result[envVar] = keyPath;
  }

  return result;
}

/** Find and read `.env.keyshelf`, returning the parsed mapping or `null`. */
export async function readEnvKeyshelf(from?: string): Promise<Record<string, string> | null> {
  const filePath = findEnvKeyshelfPath(from);
  if (!filePath) return null;

  const content = await readFile(filePath, "utf-8");
  return parseEnvKeyshelf(content);
}
