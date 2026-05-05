import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { identityToRecipient } from "age-encryption";
import type { ProviderContext, ProviderListContext, StoredKey } from "./types.js";

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

// Shared by `gcp` and `aws` listers: both encode env-or-not into the secret
// id by joining segments with a per-provider delimiter. After stripping the
// keyshelf prefix and splitting, this turns the remaining segments back into
// a `{ keyPath, envName }` pair — using the known env set to disambiguate
// whether the leading segment is an env or part of the path.
export function parseStoredSecretSegments(segments: string[], envs: Set<string>): StoredKey | null {
  if (segments.length === 0 || segments[0] === "") return null;
  const envName = envs.has(segments[0]) ? segments[0] : undefined;
  const pathSegs = envName === undefined ? segments : segments.slice(1);
  if (pathSegs.length === 0) return null;
  return { keyPath: pathSegs.join("/"), envName };
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
