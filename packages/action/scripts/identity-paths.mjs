import { homedir } from "node:os";
import { isAbsolute, join, resolve as pathResolve } from "node:path";

const IDENTITY_PROVIDER_KINDS = new Set(["provider:age", "provider:sops"]);

export function identityFile(binding) {
  if (typeof binding !== "object" || binding === null) return undefined;
  if (!IDENTITY_PROVIDER_KINDS.has(binding.__kind)) return undefined;
  const file = binding.options?.identityFile;
  return typeof file === "string" && file.length > 0 ? file : undefined;
}

export function collectIdentityFiles(config) {
  const seen = new Set();
  for (const record of config.keys) {
    if (record.kind !== "secret") continue;
    addIfIdentity(seen, record.value);
    for (const v of Object.values(record.values ?? {})) addIfIdentity(seen, v);
  }
  return [...seen];
}

function addIfIdentity(seen, binding) {
  const file = identityFile(binding);
  if (file !== undefined) seen.add(file);
}

export function resolveIdentityPath(filePath, rootDir) {
  if (filePath === "~" || filePath.startsWith("~/")) {
    return join(homedir(), filePath.slice(1));
  }
  if (isAbsolute(filePath)) return filePath;
  return pathResolve(rootDir, filePath);
}

export function ensureTrailingNewline(content) {
  return content.endsWith("\n") ? content : content + "\n";
}
