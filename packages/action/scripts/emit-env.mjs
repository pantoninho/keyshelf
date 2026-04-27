#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";

const env = process.env.KEYSHELF_ENV;
const mapsRaw = process.env.KEYSHELF_MAPS || "";
const cwd = process.env.KEYSHELF_CWD || process.cwd();
const githubEnv = process.env.GITHUB_ENV;

if (!env) fail("KEYSHELF_ENV is required");
if (!githubEnv) fail("GITHUB_ENV is not set; this script must run inside GitHub Actions");

const maps = mapsRaw
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

if (maps.length === 0) fail("'map' input is empty");

const cliBin = createRequire(import.meta.url).resolve("keyshelf/bin");

for (const mapFile of maps) {
  const result = spawnSync(
    process.execPath,
    [cliBin, "ls", "--env", env, "--reveal", "--map", mapFile, "--format", "json"],
    { cwd, encoding: "utf-8" }
  );

  if (result.status !== 0) {
    process.stderr.write(result.stderr || "");
    fail(`keyshelf ls failed for map "${mapFile}" (exit ${result.status})`);
  }

  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch (err) {
    fail(`Failed to parse keyshelf JSON output for map "${mapFile}": ${err.message}`);
  }

  for (const v of payload.vars) {
    if (v.secret) process.stdout.write(`::add-mask::${v.value}\n`);
  }

  for (const v of payload.vars) {
    appendEnv(v.envVar, v.value);
  }
}

function appendEnv(name, value) {
  const delim = `EOF_${randomBytes(8).toString("hex")}`;
  if (value.includes(delim)) {
    fail(`Generated heredoc delimiter collided with value of ${name}; refusing to emit`);
  }
  appendFileSync(githubEnv, `${name}<<${delim}\n${value}\n${delim}\n`);
}

function fail(msg) {
  process.stderr.write(`::error::${msg}\n`);
  process.exit(1);
}
