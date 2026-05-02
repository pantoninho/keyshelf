import { Command } from "commander";
import { loadV5Config } from "../config/index.js";
import {
  formatSkipCause,
  renderAppMapping,
  resolveWithStatus,
  validate
} from "../resolver/index.js";
import { createDefaultRegistry } from "../../providers/setup.js";
import { splitList } from "./options.js";
import type { BuiltinProviderRef, ConfigBinding, NormalizedRecord } from "../config/types.js";
import type { V5KeyResolutionStatus, V5Resolution } from "../resolver/types.js";
import type { AppMapping } from "../../config/app-mapping.js";

type LsFormat = "table" | "json";

interface LsOptions {
  env?: string;
  group?: string;
  filter?: string;
  reveal?: boolean;
  map?: string;
  format?: string;
}

interface KeyRow {
  path: string;
  kind: string;
  group: string;
  detail: string;
}

interface JsonVar {
  envVar: string;
  keyPath: string | null;
  value: string;
  secret: boolean;
  template?: true;
}

export const lsCommand = new Command("ls")
  .description(
    "List records declared in keyshelf.config.ts with their kind, group, and active binding"
  )
  .option("--env <env>", "Environment name; selects which per-env binding the detail column shows")
  .option(
    "--group <names>",
    "Comma-separated group filter; keys outside the set are marked filtered"
  )
  .option(
    "--filter <prefixes>",
    "Comma-separated key-path prefix filter (e.g. db,log); non-matching keys are marked filtered"
  )
  .option("--reveal", "Resolve through bound providers and show resolved values (requires --env)")
  .option("--map <file>", "Path to app mapping file (default: .env.keyshelf)")
  .option("--format <format>", "Output format: table (default) or json", "table")
  .action(async (opts: LsOptions) => {
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
    const loaded = await loadV5Config(appDir, { mappingFile: opts.map });
    const groups = splitList(opts.group);
    const filters = splitList(opts.filter);

    if (opts.reveal && opts.env !== undefined) {
      const registry = createDefaultRegistry();
      const resolveOpts = {
        config: loaded.config,
        envName: opts.env,
        rootDir: loaded.rootDir,
        registry,
        groups,
        filters
      };

      const validation = await validate(resolveOpts);
      if (validation.topLevelErrors.length > 0) {
        for (const err of validation.topLevelErrors) console.error(`error: ${err.message}`);
        process.exit(1);
      }
      if (validation.keyErrors.length > 0) {
        console.error("Validation errors:");
        for (const err of validation.keyErrors) console.error(`  - ${err.path}: ${err.message}`);
        process.exit(1);
      }

      const resolution = await resolveWithStatus(resolveOpts);

      if (format === "json") {
        const vars = buildJsonVars(loaded.appMapping, loaded.config.keys, resolution);
        process.stdout.write(JSON.stringify({ env: opts.env, vars }, null, 2) + "\n");
        return;
      }

      console.error("warning: revealing secret values");
      printRows(buildRevealedRows(loaded.config.keys, resolution));
      return;
    }

    printRows(buildSchemaRows(loaded.config.keys, opts.env, groups, filters));
  });

function parseFormat(raw: string | undefined): LsFormat {
  if (raw === undefined || raw === "table") return "table";
  if (raw === "json") return "json";
  console.error(`error: unknown --format value "${raw}" (expected "table" or "json")`);
  process.exit(1);
}

function buildSchemaRows(
  records: NormalizedRecord[],
  envName: string | undefined,
  groups: string[] | undefined,
  filters: string[] | undefined
): KeyRow[] {
  const groupSet = groups ? new Set(groups) : undefined;
  const filterPrefixes = filters ?? [];

  return records.map((record): KeyRow => {
    const filtered = isFiltered(record, groupSet, filterPrefixes);
    return {
      path: record.path,
      kind: record.kind,
      group: record.group ?? "",
      detail: filtered ? "(filtered)" : describeSource(record, envName)
    };
  });
}

function buildRevealedRows(records: NormalizedRecord[], resolution: V5Resolution): KeyRow[] {
  return records.map((record): KeyRow => {
    const status = resolution.statusByPath.get(record.path);
    return {
      path: record.path,
      kind: record.kind,
      group: record.group ?? "",
      detail: describeStatus(record, status)
    };
  });
}

function describeStatus(
  record: NormalizedRecord,
  status: V5KeyResolutionStatus | undefined
): string {
  if (status?.status === "resolved") return status.value;
  if (status?.status === "filtered") return "(filtered)";
  if (status?.status === "skipped") {
    if (record.optional) return "(optional, no value)";
    return `key '${record.path}' ${formatSkipCause(status.cause)}`;
  }
  if (status?.status === "error") return `error: ${status.message}`;
  return "(missing)";
}

function describeSource(record: NormalizedRecord, envName: string | undefined): string {
  const binding = getActiveBinding(record, envName);

  if (record.kind === "secret") {
    if (binding !== undefined) {
      return `provider: ${(binding as BuiltinProviderRef).name}`;
    }
    if (record.optional) return "(optional, no provider)";
    return "(no provider bound)";
  }

  if (binding !== undefined) {
    return `value: ${formatScalar(binding as ConfigBinding)}`;
  }
  if (record.optional) return "(optional, no value)";
  return "(missing)";
}

function getActiveBinding(record: NormalizedRecord, envName: string | undefined): unknown {
  if (
    envName !== undefined &&
    record.values !== undefined &&
    Object.hasOwn(record.values, envName)
  ) {
    return record.values[envName];
  }
  return record.value;
}

function formatScalar(value: ConfigBinding): string {
  return typeof value === "string" ? value : String(value);
}

function isFiltered(
  record: NormalizedRecord,
  groupSet: Set<string> | undefined,
  filterPrefixes: string[]
): boolean {
  if (groupSet !== undefined && groupSet.size > 0) {
    if (record.group !== undefined && !groupSet.has(record.group)) return true;
  }
  if (filterPrefixes.length > 0) {
    const matches = filterPrefixes.some(
      (prefix) => record.path === prefix || record.path.startsWith(`${prefix}/`)
    );
    if (!matches) return true;
  }
  return false;
}

function buildJsonVars(
  mappings: AppMapping[],
  records: NormalizedRecord[],
  resolution: V5Resolution
): JsonVar[] {
  const recordByPath = new Map(records.map((record) => [record.path, record]));
  const rendered = renderAppMapping(mappings, resolution);

  return rendered.flatMap((result): JsonVar[] => {
    if (result.status !== "rendered") return [];

    if ("template" in result.mapping) {
      const secret = result.mapping.keyPaths.some(
        (path) => recordByPath.get(path)?.kind === "secret"
      );
      return [
        {
          envVar: result.envVar,
          keyPath: null,
          value: result.value,
          secret,
          template: true
        }
      ];
    }

    return [
      {
        envVar: result.envVar,
        keyPath: result.mapping.keyPath,
        value: result.value,
        secret: recordByPath.get(result.mapping.keyPath)?.kind === "secret"
      }
    ];
  });
}

function printRows(rows: KeyRow[]): void {
  if (rows.length === 0) return;
  const pathWidth = Math.max(...rows.map((r) => r.path.length));
  const kindWidth = Math.max(...rows.map((r) => r.kind.length));
  const groupWidth = Math.max(...rows.map((r) => r.group.length));

  for (const row of rows) {
    const parts = [row.path.padEnd(pathWidth), row.kind.padEnd(kindWidth)];
    if (groupWidth > 0) parts.push(row.group.padEnd(groupWidth));
    parts.push(row.detail);
    console.log(parts.filter((p) => p !== "").join("   "));
  }
}
