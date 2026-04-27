#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import {
  loadConfig,
  resolve,
  isTemplateMapping,
  resolveTemplate,
  ProviderRegistry,
  PlaintextProvider,
  AgeProvider,
  SopsProvider
} from "keyshelf";

const env = process.env.KEYSHELF_ENV;
const mapsRaw = process.env.KEYSHELF_MAPS || "";
const cwd = process.env.KEYSHELF_CWD || process.cwd();
const githubEnv = process.env.GITHUB_ENV;

const BUNDLED_PROVIDERS = new Set(["plaintext", "age", "sops"]);

if (!env) fail("KEYSHELF_ENV is required");
if (!githubEnv) fail("GITHUB_ENV is not set; this script must run inside GitHub Actions");

const maps = mapsRaw
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

if (maps.length === 0) fail("'map' input is empty");

for (const mapFile of maps) {
  let vars;
  try {
    vars = await resolveMap(cwd, env, mapFile);
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
  const config = await loadConfig(appDir, envName, { mappingFile: mapFile });

  const providerName = config.env.defaultProvider?.name;
  if (providerName && !BUNDLED_PROVIDERS.has(providerName)) {
    fail(
      `Provider "${providerName}" is not bundled into the keyshelf action. ` +
        `Bundled providers: ${[...BUNDLED_PROVIDERS].join(", ")}. ` +
        `See https://github.com/pantoninho/keyshelf/issues/73 for status.`
    );
  }

  const registry = new ProviderRegistry();
  registry.register(new PlaintextProvider());
  registry.register(new AgeProvider());
  registry.register(new SopsProvider());

  const resolved = await resolve({
    schema: config.schema,
    env: config.env,
    envName,
    rootDir: config.rootDir,
    registry
  });
  const resolvedMap = new Map(resolved.map((r) => [r.path, r.value]));
  const schemaByPath = new Map(config.schema.map((k) => [k.path, k]));

  const vars = [];
  for (const mapping of config.appMapping) {
    if (isTemplateMapping(mapping)) {
      const { value, missing } = resolveTemplate(mapping.template, resolvedMap);
      for (const m of missing) {
        process.stderr.write(
          `warning: ${mapping.envVar} references "${m}" which is not defined in schema\n`
        );
      }
      const secret = mapping.keyPaths.some((p) => schemaByPath.get(p)?.isSecret === true);
      vars.push({ envVar: mapping.envVar, value, secret });
    } else {
      const value = resolvedMap.get(mapping.keyPath);
      if (value === undefined) continue;
      const secret = schemaByPath.get(mapping.keyPath)?.isSecret === true;
      vars.push({ envVar: mapping.envVar, value, secret });
    }
  }
  return vars;
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
