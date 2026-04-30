import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { createJiti } from "jiti";
import { parseAppMapping, type AppMapping } from "../../config/app-mapping.js";
import { normalizeConfig, validateAppMappingReferences } from "./schema.js";
import type { KeyshelfConfig, NormalizedConfig } from "./types.js";

const CONFIG_FILE = "keyshelf.config.ts";
const APP_MAPPING_FILE = ".env.keyshelf";

export interface LoadedV5Config {
  rootDir: string;
  configPath: string;
  config: NormalizedConfig;
  appMapping: AppMapping[];
  loadTimeMs: number;
}

export interface LoadV5ConfigOptions {
  configPath?: string;
  mappingFile?: string;
}

export function findV5RootDir(from: string): string {
  let dir = resolve(from);

  while (true) {
    if (existsSync(join(dir, CONFIG_FILE))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not find ${CONFIG_FILE} in ${from} or any parent directory`);
    }
    dir = parent;
  }
}

export async function loadV5Config(
  appDir: string,
  options: LoadV5ConfigOptions = {}
): Promise<LoadedV5Config> {
  const explicitConfigPath =
    options.configPath === undefined ? undefined : resolve(options.configPath);
  const rootDir =
    explicitConfigPath === undefined ? findV5RootDir(appDir) : dirname(explicitConfigPath);
  const configPath = explicitConfigPath ?? join(rootDir, CONFIG_FILE);

  const started = performance.now();
  const rawConfig = await importConfig(configPath);
  const config = normalizeConfig(rawConfig);
  const loadTimeMs = performance.now() - started;

  const mappingPath = options.mappingFile
    ? resolve(options.mappingFile)
    : join(resolve(appDir), APP_MAPPING_FILE);
  const appMapping = await loadAppMapping(mappingPath, options.mappingFile !== undefined);
  validateAppMappingReferences(appMapping, config.keys);

  return {
    rootDir,
    configPath,
    config,
    appMapping,
    loadTimeMs
  };
}

async function importConfig(configPath: string): Promise<KeyshelfConfig> {
  // Pin `keyshelf/config` to the running CLI build. If we let jiti resolve via
  // node_modules, a user with a different keyshelf version installed would get
  // factories whose `__kind` literals are produced by *that* package's source.
  // The discriminated unions in schema.ts match by string equality, so values
  // would parse — until the schemas drift. This alias keeps factory output and
  // validators in lockstep regardless of what's installed.
  const configModulePath = fileURLToPath(new URL("./index.js", import.meta.url));
  const jiti = createJiti(import.meta.url, {
    alias: {
      "keyshelf/config": configModulePath
    }
  });
  return await jiti.import<KeyshelfConfig>(configPath, { default: true });
}

async function loadAppMapping(mappingPath: string, required: boolean): Promise<AppMapping[]> {
  try {
    return parseAppMapping(await readFile(mappingPath, "utf-8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      if (required) {
        throw new Error(`App mapping file not found: ${mappingPath}`, {
          cause: err
        });
      }
      return [];
    }
    throw err;
  }
}
