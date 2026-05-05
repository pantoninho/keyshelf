#!/usr/bin/env node
import { writeFile, mkdir, chmod } from "node:fs/promises";
import { dirname } from "node:path";
import { loadConfig } from "keyshelf";
import {
  collectIdentityFiles,
  ensureTrailingNewline,
  resolveIdentityPath
} from "./identity-paths.mjs";

const identity = process.env.KEYSHELF_IDENTITY;
const cwd = process.env.KEYSHELF_CWD || process.cwd();

if (!identity) {
  process.stdout.write("No identity provided; skipping identity write.\n");
  process.exit(0);
}

const loaded = await loadConfig(cwd);
const identityFiles = collectIdentityFiles(loaded.config);

if (identityFiles.length === 0) {
  process.stdout.write(
    `::warning::'identity' input was provided but config "${loaded.config.name}" declares no providers that consume an identity file. Ignoring.\n`
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
