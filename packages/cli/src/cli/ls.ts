import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { findRootDir, loadConfig } from "../config/loader.js";
import { parseSchema, type KeyDefinition } from "../config/schema.js";
import { isTaggedValue, type TaggedValue } from "../config/yaml-tags.js";
import type { EnvConfig } from "../config/environment.js";
import { resolve } from "../resolver/index.js";
import { createDefaultRegistry } from "../providers/setup.js";
import { isTemplateMapping, resolveTemplate, type AppMapping } from "../config/app-mapping.js";

interface KeyRow {
  path: string;
  type: string;
  detail: string;
}

interface JsonVar {
  envVar: string;
  keyPath: string | null;
  value: string;
  secret: boolean;
  template?: true;
}

type LsFormat = "table" | "json";

interface LsOpts {
  env?: string;
  reveal?: boolean;
  map?: string;
  format?: string;
}

export const lsCommand = new Command("ls")
  .description("List keys defined in the schema")
  .option("--env <env>", "Environment name")
  .option("--reveal", "Resolve and show actual values (requires --env)")
  .option("--map <file>", "Path to app mapping file")
  .option("--format <format>", "Output format: table (default) or json", "table")
  .action(async (opts: LsOpts) => {
    const format = parseFormat(opts.format);

    if (opts.reveal && !opts.env) {
      console.error("error: --reveal requires --env");
      process.exit(1);
    }

    if (format === "json" && !(opts.reveal && opts.env && opts.map)) {
      console.error("error: --format json requires --reveal, --env, and --map");
      process.exit(1);
    }

    const appDir = process.cwd();

    if (opts.env && opts.reveal) {
      await printRevealed(appDir, opts.env, opts.map, format);
    } else if (opts.env) {
      await printWithEnv(appDir, opts.env, opts.map);
    } else {
      await printSchemaOnly(appDir);
    }
  });

function parseFormat(raw: string | undefined): LsFormat {
  if (raw === undefined || raw === "table") return "table";
  if (raw === "json") return "json";
  console.error(`error: unknown --format value "${raw}" (expected "table" or "json")`);
  process.exit(1);
}

async function printSchemaOnly(appDir: string): Promise<void> {
  const rootDir = findRootDir(appDir);
  const content = await readFile(join(rootDir, "keyshelf.yaml"), "utf-8");
  const { keys } = parseSchema(content);

  const rows = keys.map((key): KeyRow => {
    const type = key.isSecret ? "secret" : "config";
    let detail = "";
    if (key.defaultValue !== undefined) {
      detail = `default: ${key.defaultValue}`;
    } else if (key.optional) {
      detail = "(optional)";
    }
    return { path: key.path, type, detail };
  });

  printRows(rows);
}

async function printWithEnv(appDir: string, envName: string, mapFile?: string): Promise<void> {
  const config = await loadConfig(appDir, envName, { mappingFile: mapFile });

  const rows = config.schema.map((key): KeyRow => {
    const type = key.isSecret ? "secret" : "config";
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
    return "(optional, no value)";
  }

  return "(missing)";
}

async function printRevealed(
  appDir: string,
  envName: string,
  mapFile: string | undefined,
  format: LsFormat
): Promise<void> {
  if (format === "table") {
    console.error("warning: revealing secret values");
  }

  const config = await loadConfig(appDir, envName, { mappingFile: mapFile });
  const registry = createDefaultRegistry();

  const resolved = await resolve({
    schema: config.schema,
    env: config.env,
    envName,
    rootDir: config.rootDir,
    registry,
    keyshelfName: config.name
  });

  const resolvedMap = new Map(resolved.map((r) => [r.path, r.value]));

  if (format === "json") {
    const vars = buildJsonVars(config.appMapping, config.schema, resolvedMap);
    process.stdout.write(JSON.stringify({ env: envName, vars }, null, 2) + "\n");
    return;
  }

  const rows = config.schema.map((key): KeyRow => {
    const type = key.isSecret ? "secret" : "config";
    const value = resolvedMap.get(key.path);
    const detail =
      value !== undefined ? value : key.optional ? "(optional, no value)" : "(missing)";
    return { path: key.path, type, detail };
  });

  printRows(rows);
}

export function buildJsonVars(
  appMapping: AppMapping[],
  schema: KeyDefinition[],
  resolvedMap: Map<string, string>
): JsonVar[] {
  const schemaByPath = new Map(schema.map((k) => [k.path, k]));
  const vars: JsonVar[] = [];

  for (const mapping of appMapping) {
    if (isTemplateMapping(mapping)) {
      const { value, missing } = resolveTemplate(mapping.template, resolvedMap);
      for (const m of missing) {
        console.error(
          `warning: ${mapping.envVar} references "${m}" which is not defined in schema`
        );
      }
      const secret = mapping.keyPaths.some((p) => schemaByPath.get(p)?.isSecret === true);
      vars.push({ envVar: mapping.envVar, keyPath: null, value, secret, template: true });
    } else {
      const value = resolvedMap.get(mapping.keyPath);
      if (value === undefined) continue;
      const secret = schemaByPath.get(mapping.keyPath)?.isSecret === true;
      vars.push({ envVar: mapping.envVar, keyPath: mapping.keyPath, value, secret });
    }
  }

  return vars;
}

function printRows(rows: KeyRow[]): void {
  if (rows.length === 0) return;

  const pathWidth = Math.max(...rows.map((r) => r.path.length));
  const typeWidth = Math.max(...rows.map((r) => r.type.length));

  for (const row of rows) {
    const line = [row.path.padEnd(pathWidth), row.type.padEnd(typeWidth), row.detail]
      .filter(Boolean)
      .join("   ");
    console.log(line);
  }
}
