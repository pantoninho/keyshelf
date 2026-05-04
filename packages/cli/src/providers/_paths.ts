import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { ProviderContext } from "./types.js";

export function resolvePath(filePath: string, rootDir: string): string {
  if (filePath.startsWith("~/") || filePath === "~") {
    return join(homedir(), filePath.slice(1));
  }
  if (isAbsolute(filePath)) {
    return filePath;
  }
  return resolve(rootDir, filePath);
}

export async function readIdentity(identityFile: string): Promise<string> {
  const content = await readFile(identityFile, "utf-8");
  return content.trim();
}

export function requireStringConfig(
  providerName: string,
  ctx: ProviderContext,
  key: string
): string {
  const value = ctx.config[key];
  if (typeof value !== "string") {
    throw new Error(`${providerName} provider requires "${key}" config for "${ctx.keyPath}"`);
  }
  return value;
}
