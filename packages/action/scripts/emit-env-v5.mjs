#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import {
  AgeProvider,
  PlaintextProvider,
  ProviderRegistry,
  SopsProvider,
  formatSkipCause,
  loadV5Config,
  renderAppMapping,
  resolveWithStatus,
  validate
} from "keyshelf/v5";

const envName = process.env.KEYSHELF_ENV || undefined;
const mapsRaw = process.env.KEYSHELF_MAPS || "";
const groupsRaw = process.env.KEYSHELF_GROUPS || "";
const filtersRaw = process.env.KEYSHELF_FILTERS || "";
const cwd = process.env.KEYSHELF_CWD || process.cwd();
const githubEnv = process.env.GITHUB_ENV;

if (!githubEnv) fail("GITHUB_ENV is not set; this script must run inside GitHub Actions");

const maps = mapsRaw
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);
if (maps.length === 0) fail("'map' input is empty");

const groups = splitList(groupsRaw);
const filters = splitList(filtersRaw);

const registry = new ProviderRegistry();
registry.register(new PlaintextProvider());
registry.register(new AgeProvider());
registry.register(new SopsProvider());

for (const mapFile of maps) {
  let vars;
  try {
    vars = await resolveMap(cwd, envName, mapFile);
  } catch (err) {
    fail(`Failed to resolve map "${mapFile}": ${err.message}`);
  }

  for (const v of vars) {
    if (v.secret) process.stdout.write(`::add-mask::${v.value}\n`);
  }
  for (const v of vars) {
    appendEnv(v.envVar, v.value);
  }
}

async function resolveMap(appDir, envName, mapFile) {
  const loaded = await loadV5Config(appDir, { mappingFile: mapFile });
  const resolveOpts = {
    config: loaded.config,
    envName,
    rootDir: loaded.rootDir,
    registry,
    groups,
    filters
  };

  const validation = await validate(resolveOpts);
  if (validation.topLevelErrors.length > 0) {
    fail(validation.topLevelErrors.map((e) => e.message).join("; "));
  }
  if (validation.keyErrors.length > 0) {
    const lines = validation.keyErrors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    fail(`Validation errors:\n${lines}`);
  }

  const resolution = await resolveWithStatus(resolveOpts);
  const rendered = renderAppMapping(loaded.appMapping, resolution);
  const recordByPath = new Map(loaded.config.keys.map((k) => [k.path, k]));

  const vars = [];
  for (const result of rendered) {
    if (result.status === "skipped") {
      process.stderr.write(
        `keyshelf: skipping ${result.envVar} — referenced key '${result.keyPath}' ${formatSkipCause(result.cause)}\n`
      );
      continue;
    }

    const secret =
      "template" in result.mapping
        ? result.mapping.keyPaths.some((p) => recordByPath.get(p)?.kind === "secret")
        : recordByPath.get(result.mapping.keyPath)?.kind === "secret";
    vars.push({ envVar: result.envVar, value: result.value, secret });
  }
  return vars;
}

function splitList(raw) {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
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
