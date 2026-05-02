import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../config/index.js";
import { isTemplateMapping } from "../config/app-mapping.js";
import { createDefaultRegistry } from "../providers/setup.js";
import { splitList } from "./options.js";
import type { BuiltinProviderRef, NormalizedRecord } from "../config/types.js";

interface ImportOptions {
  env?: string;
  file: string;
  map?: string;
  group?: string;
}

function parseDotEnv(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();
    if (key) vars[key] = value;
  }
  return vars;
}

export const importCommand = new Command("import")
  .description(
    "Bulk-write secret values to their bound providers from a .env file (does not edit keyshelf.config.ts)"
  )
  .requiredOption("--file <file>", "Path to .env file to import")
  .option("--env <env>", "Environment to import into (selects per-env provider binding)")
  .option("--group <names>", "Comma-separated group filter; keys outside the set are skipped")
  .option("--map <map>", "Path to app mapping file (default: .env.keyshelf)")
  .action(async (opts: ImportOptions) => {
    const appDir = process.cwd();
    const loaded = await loadConfig(appDir, { mappingFile: opts.map });

    const recordByPath = new Map(loaded.config.keys.map((record) => [record.path, record]));
    const reverseMap = new Map(
      loaded.appMapping
        .filter((mapping) => !isTemplateMapping(mapping))
        .map((mapping) => [mapping.envVar, (mapping as { keyPath: string }).keyPath])
    );

    const groupList = splitList(opts.group);
    const groupSet = groupList ? new Set(groupList) : undefined;

    const dotEnvContent = await readFile(opts.file, "utf-8");
    const dotEnvVars = parseDotEnv(dotEnvContent);

    const registry = createDefaultRegistry();
    let imported = 0;
    let skipped = 0;

    for (const [envVar, value] of Object.entries(dotEnvVars)) {
      const keyPath = reverseMap.get(envVar);
      if (keyPath === undefined) {
        skipped++;
        continue;
      }

      const record = recordByPath.get(keyPath);
      if (record === undefined) {
        console.error(`warning: ${envVar} maps to "${keyPath}" which is not declared in config`);
        skipped++;
        continue;
      }

      if (record.kind === "config") {
        console.error(
          `warning: ${envVar} -> ${keyPath} is a config key; keyshelf does not write config via import (edit keyshelf.config.ts directly)`
        );
        skipped++;
        continue;
      }

      if (groupSet !== undefined && (record.group === undefined || !groupSet.has(record.group))) {
        console.error(`warning: ${envVar} -> ${keyPath} filtered out by --group; skipping`);
        skipped++;
        continue;
      }

      const providerRef = pickProviderRef(record, opts.env);
      if (providerRef === undefined) {
        const envHint = opts.env ?? "(envless)";
        console.error(
          `warning: ${envVar} -> ${keyPath} has no provider binding for env ${envHint}; skipping`
        );
        skipped++;
        continue;
      }

      const provider = registry.get(providerRef.name);
      await provider.set(
        {
          keyPath,
          envName: opts.env,
          rootDir: loaded.rootDir,
          config: { ...(providerRef.options as unknown as Record<string, unknown>) },
          keyshelfName: loaded.config.name
        },
        value
      );
      console.log(`  secret: ${envVar} -> ${keyPath} (via ${providerRef.name})`);
      imported++;
    }

    console.log(`\nImported ${imported} values, skipped ${skipped}`);
  });

function pickProviderRef(
  record: NormalizedRecord & { kind: "secret" },
  envName: string | undefined
): BuiltinProviderRef | undefined {
  if (
    envName !== undefined &&
    record.values !== undefined &&
    Object.hasOwn(record.values, envName)
  ) {
    return record.values[envName];
  }
  return record.value;
}
