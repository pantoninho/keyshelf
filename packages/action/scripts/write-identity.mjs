#!/usr/bin/env node
import { writeFile, mkdir, chmod } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve as pathResolve } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "keyshelf";

const env = process.env.KEYSHELF_ENV;
const identity = process.env.KEYSHELF_IDENTITY;
const cwd = process.env.KEYSHELF_CWD || process.cwd();

if (!env) fail("KEYSHELF_ENV is required");
if (!identity) {
  process.stdout.write("No identity provided; skipping identity write.\n");
  process.exit(0);
}

const config = await loadConfig(cwd, env);
const provider = config.env.defaultProvider;

if (!provider) {
  fail(`Environment "${env}" has no default-provider configured`);
}

const identityFile = provider.options?.identityFile;
if (typeof identityFile !== "string" || identityFile.length === 0) {
  process.stdout.write(
    `::warning::'identity' input was provided but provider "${provider.name}" does not declare an identityFile (e.g. gcp). Ignoring.\n`
  );
  process.exit(0);
}

const target = resolveIdentityPath(identityFile, config.rootDir);

await mkdir(dirname(target), { recursive: true });
await writeFile(target, ensureTrailingNewline(identity), { mode: 0o600 });
await chmod(target, 0o600);

process.stdout.write(`Wrote identity to ${target} (mode 0600)\n`);

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

function fail(msg) {
  process.stderr.write(`::error::${msg}\n`);
  process.exit(1);
}
