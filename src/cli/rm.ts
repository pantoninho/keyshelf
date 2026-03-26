import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import { findRootDir } from "../config/loader.js";
import { parseSchema } from "../config/schema.js";
import { parseProviderBlock } from "../config/environment.js";
import { createDefaultRegistry } from "../providers/setup.js";
import { KEYSHELF_SCHEMA, isTaggedValue } from "../config/yaml-tags.js";
import { flattenKeys, deleteNestedValue } from "../utils/paths.js";

export const rmCommand = new Command("rm")
  .description("Remove a config or secret value from an environment")
  .requiredOption("--env <env>", "Environment name")
  .argument("<key>", "Key path (e.g. db/password)")
  .action(async (keyPath: string, opts: { env: string }) => {
    const rootDir = findRootDir(process.cwd());
    const envFilePath = join(rootDir, ".keyshelf", `${opts.env}.yaml`);

    // Load env file
    let envDoc: Record<string, unknown>;
    try {
      const content = await readFile(envFilePath, "utf-8");
      envDoc = (yaml.load(content, { schema: KEYSHELF_SCHEMA }) ?? {}) as Record<string, unknown>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Environment file not found: ${envFilePath}`);
      }
      throw err;
    }

    // Find override in env file
    const keysBlock = (envDoc.keys ?? {}) as Record<string, unknown>;
    const flat = flattenKeys(keysBlock);
    const override = flat[keyPath];
    const hasOverride = keyPath in flat;

    // Load schema to check if key is a secret with default-provider
    const schemaContent = await readFile(join(rootDir, "keyshelf.yaml"), "utf-8");
    const schema = parseSchema(schemaContent);
    const keyDef = schema.keys.find((k) => k.path === keyPath);

    // Determine default provider config (same merge logic as loader)
    const envProvider = parseProviderBlock(envDoc["default-provider"]);
    const globalProvider = schema.config.provider;
    let defaultProvider = envProvider;
    if (!defaultProvider && globalProvider) {
      defaultProvider = globalProvider;
    } else if (defaultProvider && globalProvider && defaultProvider.name === globalProvider.name) {
      defaultProvider = {
        name: defaultProvider.name,
        options: { ...globalProvider.options, ...defaultProvider.options }
      };
    }

    const registry = createDefaultRegistry();

    // Delete from provider if needed
    if (hasOverride && isTaggedValue(override)) {
      // Provider-tagged override — delete from provider
      const provider = registry.get(override.tag);
      const baseConfig =
        defaultProvider?.name === override.tag ? { ...defaultProvider.options } : {};
      const ctx = {
        keyPath,
        envName: opts.env,
        config: { ...baseConfig, ...override.config }
      };
      await provider.delete(ctx);
    } else if (!hasOverride && keyDef?.isSecret && defaultProvider) {
      // Secret using default provider — delete from provider
      const provider = registry.get(defaultProvider.name);
      const ctx = {
        keyPath,
        envName: opts.env,
        config: { ...defaultProvider.options }
      };
      await provider.delete(ctx);
    } else if (!hasOverride) {
      throw new Error(`Key "${keyPath}" not found in ${opts.env} environment`);
    }

    // Remove from env file if it was there
    if (hasOverride) {
      deleteNestedValue(keysBlock, keyPath);

      // Clean up empty keys block
      if (Object.keys(keysBlock).length === 0) {
        delete envDoc.keys;
      }

      await writeFile(envFilePath, yaml.dump(envDoc, { schema: KEYSHELF_SCHEMA }), "utf-8");
    }

    console.log(`Removed "${keyPath}" from ${opts.env}`);
  });
