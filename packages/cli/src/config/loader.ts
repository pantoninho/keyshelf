import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { createJiti, type Jiti } from "jiti";
import { parseAppMapping, type AppMapping } from "./app-mapping.js";
import { normalizeConfig, validateAppMappingReferences } from "./schema.js";
import type { KeyshelfConfig, NormalizedConfig } from "./types.js";
import { loadYamlConfig } from "./yaml-loader.js";

const TS_CONFIG_FILE = "keyshelf.config.ts";
const YAML_CONFIG_FILE = "keyshelf.yaml";
const APP_MAPPING_FILE = ".env.keyshelf";

let cachedJiti: Jiti | undefined;

function getJiti(): Jiti {
  if (cachedJiti === undefined) {
    // Pin `keyshelf/config` to the running CLI build. If we let jiti resolve via
    // node_modules, a user with a different keyshelf version installed would get
    // factories whose `__kind` literals are produced by *that* package's source.
    // The discriminated unions in schema.ts match by string equality, so values
    // would parse — until the schemas drift. This alias keeps factory output and
    // validators in lockstep regardless of what's installed.
    // Aliased to `./factories.js` (not the barrel `./index.js`) because that's
    // the only module users need from `keyshelf/config` and it avoids a cycle
    // with `index.ts → loader.ts`.
    // Bundlers (e.g. tsup with noExternal) collapse the config module into
    // the same file as the loader, so the sibling file doesn't exist at
    // runtime. KEYSHELF_CONFIG_MODULE_PATH lets the bundled host (e.g. the
    // GitHub Action) point the alias at a sidecar copy.
    const override = process.env.KEYSHELF_CONFIG_MODULE_PATH;
    const configModulePath =
      override !== undefined
        ? resolve(override)
        : fileURLToPath(new URL("./factories.js", import.meta.url));
    cachedJiti = createJiti(import.meta.url, {
      alias: {
        "keyshelf/config": configModulePath
      }
    });
  }
  return cachedJiti;
}

export interface LoadedConfig {
  rootDir: string;
  configPath: string;
  config: NormalizedConfig;
  appMapping: AppMapping[];
  loadTimeMs: number;
}

export interface LoadConfigOptions {
  configPath?: string;
  mappingFile?: string;
}

export function findRootDir(from: string): string {
  let dir = resolve(from);

  while (true) {
    if (existsSync(join(dir, TS_CONFIG_FILE)) || existsSync(join(dir, YAML_CONFIG_FILE))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not find ${TS_CONFIG_FILE} or ${YAML_CONFIG_FILE} in ${from} or any parent directory`
      );
    }
    dir = parent;
  }
}

export async function loadConfig(
  appDir: string,
  options: LoadConfigOptions = {}
): Promise<LoadedConfig> {
  const explicitConfigPath =
    options.configPath === undefined ? undefined : resolve(options.configPath);
  const rootDir =
    explicitConfigPath === undefined ? findRootDir(appDir) : dirname(explicitConfigPath);
  const configPath = explicitConfigPath ?? resolveConfigPath(rootDir);

  const started = performance.now();
  const rawConfig = await loadRawConfig(configPath);
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

function resolveConfigPath(rootDir: string): string {
  const tsPath = join(rootDir, TS_CONFIG_FILE);
  if (existsSync(tsPath)) return tsPath;
  return join(rootDir, YAML_CONFIG_FILE);
}

async function loadRawConfig(configPath: string): Promise<KeyshelfConfig> {
  if (configPath.endsWith(".yaml") || configPath.endsWith(".yml")) {
    return await loadYamlConfig(configPath);
  }
  return await getJiti().import<KeyshelfConfig>(configPath, { default: true });
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
