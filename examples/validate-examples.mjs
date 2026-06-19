#!/usr/bin/env node
/*
 * Validate every example project against the built keyshelf CLI so the examples
 * can't silently rot when the v6 model changes. For each examples/NN-* directory
 * that contains a .keyshelf/ project, run "keyshelf validate --json" with that
 * directory as cwd and assert the whole-project result is valid.
 *
 * Prerequisite: build the CLI first ("npm run build -w keyshelf"). This script is
 * wired into the root "validate:examples" script, which builds then runs it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const examplesDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(examplesDir, "..");
const bin = path.join(repoRoot, "packages", "cli", "bin", "run.js");

if (!existsSync(bin)) {
  console.error(
    `keyshelf CLI not built: ${bin} is missing. Run "npm run build -w keyshelf" first.`
  );
  process.exit(1);
}

const projects = readdirSync(examplesDir, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() &&
      existsSync(path.join(examplesDir, entry.name, ".keyshelf", "config.yaml"))
  )
  .map((entry) => entry.name)
  .sort();

if (projects.length === 0) {
  console.error("No example projects found under examples/.");
  process.exit(1);
}

let failed = 0;
for (const project of projects) {
  const cwd = path.join(examplesDir, project);
  try {
    const stdout = execFileSync(process.execPath, [bin, "validate", "--json"], {
      cwd,
      encoding: "utf8"
    });
    const result = JSON.parse(stdout);
    if (result.valid !== true) {
      throw new Error(stdout);
    }

    const envs = (result.results ?? []).map((r) => r.environment).join(", ");
    console.log(`ok    ${project}  [${envs}]`);
  } catch (error) {
    failed += 1;
    const detail = error.stdout ?? error.message ?? String(error);
    console.error(`FAIL  ${project}\n${detail}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} example project(s) failed validation.`);
  process.exit(1);
}

console.log(`\nAll ${projects.length} example projects are valid.`);
