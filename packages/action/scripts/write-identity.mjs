#!/usr/bin/env node
import { writeFile, mkdir, chmod } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve as pathResolve } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "keyshelf";

const identity = process.env.KEYSHELF_IDENTITY;
const cwd = process.env.KEYSHELF_CWD || process.cwd();

if (!identity) {
  process.stdout.write("No identity provided; skipping identity write.\n");
  process.exit(0);
}

const loaded = await loadConfig(cwd);
const identityFiles = collectAgeIdentityFiles(loaded.config);

if (identityFiles.length === 0) {
  process.stdout.write(
    `::warning::'identity' input was provided but config "${loaded.config.name}" declares no age providers. Ignoring.\n`
  );
  process.exit(0);
}

for (const filePath of identityFiles) {
  const target = resolveIdentityPath(filePath, loaded.rootDir);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, ensureTrailingNewline(identity), { mode: 0o600 });
  await chmod(target, 0o600);
  process.stdout.write(`Wrote identity to ${target} (mode 0600)\n`);
}

function collectAgeIdentityFiles(config) {
  const seen = new Set();
  for (const record of config.keys) {
    if (record.kind !== "secret") continue;
    visitBinding(record.value);
    for (const v of Object.values(record.values ?? {})) visitBinding(v);
  }
  return [...seen];

  function visitBinding(binding) {
    if (binding === undefined) return;
    if (typeof binding !== "object" || binding === null) return;
    if (binding.__kind !== "provider:age") return;
    const file = binding.options?.identityFile;
    if (typeof file === "string" && file.length > 0) seen.add(file);
  }
}

function resolveIdentityPath(filePath, rootDir) {
  if (filePath === "~" || filePath.startsWith("~/")) {
    return join(homedir(), filePath.slice(1));
  }
  if (isAbsolute(filePath)) return filePath;
  return pathResolve(rootDir, filePath);
}

function ensureTrailingNewline(content) {
  return content.endsWith("\n") ? content : content + "\n";
}
