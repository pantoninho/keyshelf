import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import yaml from "js-yaml";
import { findRootDir, loadConfig } from "../config/loader.js";
import { parseAppMapping } from "../config/app-mapping.js";
import { createDefaultRegistry } from "../providers/setup.js";
import { KEYSHELF_SCHEMA } from "../config/yaml-tags.js";
import { setNestedValue } from "../utils/paths.js";

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
  .description("Bulk import values from a .env file")
  .requiredOption("--env <env>", "Environment name")
  .requiredOption("--file <file>", "Path to .env file to import")
  .option("--map <map>", "Path to app mapping file (default: .env.keyshelf)")
  .option("--provider <provider>", "Store secrets via provider")
  .action(async (opts: { env: string; file: string; map?: string; provider?: string }) => {
    const appDir = process.cwd();
    const rootDir = findRootDir(appDir);
    const config = await loadConfig(appDir, opts.env).catch(() => null);
    if (!config) {
      console.error(
        "warning: could not load keyshelf config, treating all keys as config (not secrets)"
      );
    }

    // Load app mapping
    const mappingPath = opts.map ? resolve(opts.map) : join(appDir, ".env.keyshelf");
    let mappingContent: string;
    try {
      mappingContent = await readFile(mappingPath, "utf-8");
    } catch {
      throw new Error(
        `.env.keyshelf not found in ${appDir}. This file is required to map env vars to key paths.`
      );
    }
    const appMapping = parseAppMapping(mappingContent);

    // Build reverse map: ENV_VAR -> key/path
    const reverseMap = new Map(appMapping.map((m) => [m.envVar, m.keyPath]));

    // Parse .env file
    const envFileContent = await readFile(opts.file, "utf-8");
    const dotEnvVars = parseDotEnv(envFileContent);

    // Build set of secret paths from schema
    const secretPaths = new Set(config?.schema.filter((k) => k.isSecret).map((k) => k.path) ?? []);

    // Load existing env yaml
    const envFilePath = join(rootDir, ".keyshelf", `${opts.env}.yaml`);
    let envDoc: Record<string, unknown> = {};
    try {
      const content = await readFile(envFilePath, "utf-8");
      envDoc = (yaml.load(content, { schema: KEYSHELF_SCHEMA }) ?? {}) as Record<string, unknown>;
    } catch {
      // File doesn't exist yet
    }

    const registry = createDefaultRegistry();
    let imported = 0;
    let skipped = 0;

    for (const [envVar, value] of Object.entries(dotEnvVars)) {
      const keyPath = reverseMap.get(envVar);
      if (!keyPath) {
        skipped++;
        continue;
      }

      const isSecret = secretPaths.has(keyPath);

      if (isSecret && opts.provider) {
        const provider = registry.get(opts.provider);
        const providerBlock = envDoc["default-provider"] as Record<string, unknown> | undefined;
        const providerConfig: Record<string, unknown> = {};
        if (providerBlock && providerBlock.name === opts.provider) {
          Object.assign(providerConfig, providerBlock);
          delete providerConfig.name;
        }
        await provider.set({ keyPath, envName: opts.env, config: providerConfig }, value);
        console.log(`  secret: ${envVar} -> ${keyPath} (via ${opts.provider})`);
      } else {
        setNestedValue(envDoc, keyPath, value);
        console.log(`  config: ${envVar} -> ${keyPath}`);
      }
      imported++;
    }

    await writeFile(envFilePath, yaml.dump(envDoc), "utf-8");
    console.log(`\nImported ${imported} values, skipped ${skipped}`);
  });
