import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { identityToRecipient } from "age-encryption";
import type { ProviderContext, ProviderListContext } from "./types.js";

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

export async function readIdentityWithRecipient(
  identityFile: string
): Promise<{ identity: string; recipient: string }> {
  const identity = await readIdentity(identityFile);
  const recipient = await identityToRecipient(identity);
  return { identity, recipient };
}

export function requireStringConfig(
  providerName: string,
  ctx: ProviderContext | ProviderListContext,
  key: string
): string {
  const value = ctx.config[key];
  if (typeof value !== "string") {
    const where = "keyPath" in ctx ? `for "${ctx.keyPath}"` : "for list";
    throw new Error(`${providerName} provider requires "${key}" config ${where}`);
  }
  return value;
}
