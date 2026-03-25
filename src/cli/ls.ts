import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findRootDir, loadConfig } from '../config/loader.js';
import { parseSchema, type KeyDefinition } from '../config/schema.js';
import { isTaggedValue, type TaggedValue } from '../config/yaml-tags.js';
import type { EnvConfig } from '../config/environment.js';
import { resolve } from '../resolver/index.js';
import { createDefaultRegistry } from '../providers/setup.js';

interface KeyRow {
  path: string;
  type: string;
  detail: string;
}

export const lsCommand = new Command('ls')
  .description('List keys defined in the schema')
  .option('--env <env>', 'Environment name')
  .option('--reveal', 'Resolve and show actual values (requires --env)')
  .option('--map <file>', 'Path to app mapping file')
  .action(async (opts: { env?: string; reveal?: boolean; map?: string }) => {
    if (opts.reveal && !opts.env) {
      console.error('error: --reveal requires --env');
      process.exit(1);
    }

    const appDir = process.cwd();

    if (opts.env && opts.reveal) {
      await printRevealed(appDir, opts.env, opts.map);
    } else if (opts.env) {
      await printWithEnv(appDir, opts.env, opts.map);
    } else {
      await printSchemaOnly(appDir);
    }
  });

async function printSchemaOnly(appDir: string): Promise<void> {
  const rootDir = findRootDir(appDir);
  const content = await readFile(join(rootDir, 'keyshelf.yaml'), 'utf-8');
  const { keys } = parseSchema(content);

  const rows = keys.map((key): KeyRow => {
    const type = key.isSecret ? 'secret' : 'config';
    let detail = '';
    if (key.defaultValue !== undefined) {
      detail = `default: ${key.defaultValue}`;
    } else if (key.optional) {
      detail = '(optional)';
    }
    return { path: key.path, type, detail };
  });

  printRows(rows);
}

async function printWithEnv(
  appDir: string,
  envName: string,
  mapFile?: string,
): Promise<void> {
  const config = await loadConfig(appDir, envName, { mappingFile: mapFile });

  const rows = config.schema.map((key): KeyRow => {
    const type = key.isSecret ? 'secret' : 'config';
    const detail = describeSource(key, config.env);
    return { path: key.path, type, detail };
  });

  printRows(rows);
}

export function describeSource(key: KeyDefinition, env: EnvConfig): string {
  const override = env.overrides[key.path];

  if (override !== undefined && !isTaggedValue(override)) {
    return `override: ${override}`;
  }

  if (override !== undefined && isTaggedValue(override)) {
    return `provider: ${(override as TaggedValue).tag}`;
  }

  if (key.isSecret && env.defaultProvider) {
    return `provider: ${env.defaultProvider.name}`;
  }

  if (!key.isSecret && key.defaultValue !== undefined) {
    return `default: ${key.defaultValue}`;
  }

  if (key.optional) {
    return '(optional, no value)';
  }

  return '(missing)';
}

async function printRevealed(
  appDir: string,
  envName: string,
  mapFile?: string,
): Promise<void> {
  console.error('warning: revealing secret values');

  const config = await loadConfig(appDir, envName, { mappingFile: mapFile });
  const registry = createDefaultRegistry();

  const resolved = await resolve({
    schema: config.schema,
    env: config.env,
    envName,
    registry,
  });

  const resolvedMap = new Map(resolved.map((r) => [r.path, r.value]));

  const rows = config.schema.map((key): KeyRow => {
    const type = key.isSecret ? 'secret' : 'config';
    const value = resolvedMap.get(key.path);
    let detail = '';
    if (value !== undefined) {
      detail = value;
    } else if (key.optional) {
      detail = '(optional, no value)';
    } else {
      detail = '(missing)';
    }
    return { path: key.path, type, detail };
  });

  printRows(rows);
}

function printRows(rows: KeyRow[]): void {
  if (rows.length === 0) return;

  const pathWidth = Math.max(...rows.map((r) => r.path.length));
  const typeWidth = Math.max(...rows.map((r) => r.type.length));

  for (const row of rows) {
    const line = [
      row.path.padEnd(pathWidth),
      row.type.padEnd(typeWidth),
      row.detail,
    ]
      .filter(Boolean)
      .join('   ');
    console.log(line);
  }
}
