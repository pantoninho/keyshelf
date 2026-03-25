import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { parseSchema, type KeyDefinition } from './schema.js';
import { parseEnvironment, type EnvConfig } from './environment.js';
import { parseAppMapping, type AppMapping } from './app-mapping.js';

const SCHEMA_FILE = 'keyshelf.yaml';
const ENV_DIR = '.keyshelf';
const APP_MAPPING_FILE = '.env.keyshelf';

export interface LoadedConfig {
  rootDir: string;
  schema: KeyDefinition[];
  env: EnvConfig;
  appMapping: AppMapping[];
}

export function findRootDir(from: string): string {
  let dir = resolve(from);

  while (true) {
    if (existsSync(join(dir, SCHEMA_FILE))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not find ${SCHEMA_FILE} in ${from} or any parent directory`,
      );
    }
    dir = parent;
  }
}

export async function loadConfig(
  appDir: string,
  envName: string,
  options?: { mappingFile?: string },
): Promise<LoadedConfig> {
  const rootDir = findRootDir(appDir);

  const schemaPath = join(rootDir, SCHEMA_FILE);
  const schemaContent = await readFile(schemaPath, 'utf-8');
  const parsed = parseSchema(schemaContent);
  const schema = parsed.keys;

  const envPath = join(rootDir, ENV_DIR, `${envName}.yaml`);
  let env: EnvConfig;
  try {
    const envContent = await readFile(envPath, 'utf-8');
    env = parseEnvironment(envContent);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Environment file not found: ${envPath}`, {
        cause: err,
      });
    }
    throw err;
  }

  const mappingPath = options?.mappingFile
    ? resolve(options.mappingFile)
    : join(appDir, APP_MAPPING_FILE);
  let appMapping: AppMapping[];
  try {
    const mappingContent = await readFile(mappingPath, 'utf-8');
    appMapping = parseAppMapping(mappingContent);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`App mapping file not found: ${mappingPath}`, {
        cause: err,
      });
    }
    throw err;
  }

  // Merge global provider config with env-level provider config
  const globalProvider = parsed.config.provider;
  if (globalProvider && !env.defaultProvider) {
    env = { ...env, defaultProvider: globalProvider };
  } else if (globalProvider && env.defaultProvider) {
    const envProvider = env.defaultProvider;
    env = {
      ...env,
      defaultProvider: {
        name: envProvider.name,
        options: {
          ...(globalProvider.name === envProvider.name
            ? globalProvider.options
            : {}),
          ...envProvider.options,
        },
      },
    };
  }

  return { rootDir, schema, env, appMapping };
}
