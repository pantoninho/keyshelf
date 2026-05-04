import { homedir } from "node:os";
import { isAbsolute, join, resolve as pathResolve } from "node:path";

export function ageIdentityFile(binding) {
  if (binding?.__kind !== "provider:age") return undefined;
  const file = binding.options?.identityFile;
  return typeof file === "string" && file.length > 0 ? file : undefined;
}

export function collectAgeIdentityFiles(config) {
  const seen = new Set();
  for (const record of config.keys) {
    if (record.kind !== "secret") continue;
    addIfAge(seen, record.value);
    for (const v of Object.values(record.values ?? {})) addIfAge(seen, v);
  }
  return [...seen];
}

function addIfAge(seen, binding) {
  const file = ageIdentityFile(binding);
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
