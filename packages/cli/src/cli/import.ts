import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { loadConfig, type LoadedConfig } from "../config/index.js";
import { isTemplateMapping, iterDotEnvEntries } from "../config/app-mapping.js";
import { createDefaultRegistry } from "../providers/setup.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { NormalizedRecord } from "../config/types.js";
import { splitList } from "./options.js";
import { findStaleRenameSource, pickProviderRef, writeSecret } from "./secret-binding.js";

interface ImportOptions {
  env?: string;
  file: string;
  map?: string;
  group?: string;
}

interface ImportContext {
  loaded: LoadedConfig;
  registry: ProviderRegistry;
  recordByPath: Map<string, NormalizedRecord>;
  reverseMap: Map<string, string>;
  groupSet: Set<string> | undefined;
  envName: string | undefined;
}

type ImportOutcome =
  | { kind: "imported"; stale: string | undefined }
  | { kind: "skipped"; warning?: string };

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

    const groupList = splitList(opts.group);
    const dotEnvContent = await readFile(opts.file, "utf-8");
    const dotEnvVars = parseDotEnv(dotEnvContent);

    const ctx: ImportContext = {
      loaded,
      registry: createDefaultRegistry(),
      recordByPath: new Map(loaded.config.keys.map((record) => [record.path, record])),
      reverseMap: new Map(
        loaded.appMapping
          .filter((mapping) => !isTemplateMapping(mapping))
          .map((mapping) => [mapping.envVar, (mapping as { keyPath: string }).keyPath])
      ),
      groupSet: groupList ? new Set(groupList) : undefined,
      envName: opts.env
    };

    let imported = 0;
    let skipped = 0;
    const staleRenames: string[] = [];

    for (const [envVar, value] of Object.entries(dotEnvVars)) {
      const outcome = await importOne(ctx, envVar, value);
      if (outcome.kind === "imported") {
        imported++;
        if (outcome.stale !== undefined) staleRenames.push(outcome.stale);
      } else {
        skipped++;
        if (outcome.warning !== undefined) console.error(outcome.warning);
      }
    }

    console.log(`\nImported ${imported} values, skipped ${skipped}`);
    if (staleRenames.length > 0) {
      const list = staleRenames.map((p) => `"${p}"`).join(", ");
      console.log(
        `hint: storage still holds old path${staleRenames.length === 1 ? "" : "s"} ${list}. Run \`keyshelf up\` to clean up.`
      );
    }
  });

async function importOne(
  ctx: ImportContext,
  envVar: string,
  value: string
): Promise<ImportOutcome> {
  const keyPath = ctx.reverseMap.get(envVar);
  if (keyPath === undefined) return { kind: "skipped" };

  const record = ctx.recordByPath.get(keyPath);
  if (record === undefined) {
    return {
      kind: "skipped",
      warning: `warning: ${envVar} maps to "${keyPath}" which is not declared in config`
    };
  }
  if (record.kind === "config") {
    return {
      kind: "skipped",
      warning: `warning: ${envVar} -> ${keyPath} is a config key; keyshelf does not write config via import (edit keyshelf.config.ts directly)`
    };
  }
  if (
    ctx.groupSet !== undefined &&
    (record.group === undefined || !ctx.groupSet.has(record.group))
  ) {
    return {
      kind: "skipped",
      warning: `warning: ${envVar} -> ${keyPath} filtered out by --group; skipping`
    };
  }

  const providerRef = pickProviderRef(record, ctx.envName);
  if (providerRef === undefined) {
    const envHint = ctx.envName ?? "(envless)";
    return {
      kind: "skipped",
      warning: `warning: ${envVar} -> ${keyPath} has no provider binding for env ${envHint}; skipping`
    };
  }

  await writeSecret(ctx.registry, ctx.loaded, providerRef, keyPath, ctx.envName, value);
  console.log(`  secret: ${envVar} -> ${keyPath} (via ${providerRef.name})`);

  const stale = await findStaleRenameSource(
    ctx.registry,
    ctx.loaded,
    record,
    providerRef,
    ctx.envName
  );
  return { kind: "imported", stale };
}
