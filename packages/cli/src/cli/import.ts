import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../config/index.js";
import { isTemplateMapping, iterDotEnvEntries } from "../config/app-mapping.js";
import { createDefaultRegistry } from "../providers/setup.js";
import { splitList } from "./options.js";
import { pickProviderRef, writeSecret } from "./secret-binding.js";

interface ImportOptions {
  env?: string;
  file: string;
  map?: string;
  group?: string;
}

function parseDotEnv(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const { key, value } of iterDotEnvEntries(content)) {
    vars[key] = value;
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

      await writeSecret(registry, loaded, providerRef, keyPath, opts.env, value);
      console.log(`  secret: ${envVar} -> ${keyPath} (via ${providerRef.name})`);
      imported++;
    }

    console.log(`\nImported ${imported} values, skipped ${skipped}`);
  });
