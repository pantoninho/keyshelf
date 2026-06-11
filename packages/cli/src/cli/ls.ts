import { Command } from "commander";
import { loadConfig } from "../config/index.js";
import { formatSkipCause, renderAppMapping, resolveValidated } from "../resolver/index.js";
import { createDefaultRegistry } from "../providers/setup.js";
import { splitList } from "./options.js";
import { assertValidationPasses } from "./validation.js";
import type { BuiltinProviderRef, ConfigBinding, NormalizedRecord } from "../config/types.js";
import type { KeyResolutionStatus, Resolution } from "../resolver/types.js";
import type { AppMapping } from "../config/app-mapping.js";

type LsFormat = "table" | "json";

interface LsOptions {
  env?: string;
  group?: string;
  filter?: string;
  reveal?: boolean;
  check?: boolean;
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
  .option(
    "--check",
    "Validate that every declared key resolves for --env, ignoring app mappings; exits non-zero on any unresolvable required key (CI sweep)"
  )
  .option("--map <file>", "Path to app mapping file (default: .env.keyshelf)")
  .option("--format <format>", "Output format: table (default) or json", "table")
  .action(async (opts: LsOptions) => {
    const format = parseFormat(opts.format);
    assertValidOptions(opts, format);

    const loaded = await loadConfig(process.cwd(), { mappingFile: opts.map });
    const groups = splitList(opts.group);
    const filters = splitList(opts.filter);

    if (opts.check) {
      await runCheck({ loaded, env: opts.env as string, groups, filters });
      return;
    }

    if (opts.reveal && opts.env !== undefined) {
      await runReveal({ loaded, env: opts.env, groups, filters, format });
      return;
    }

    printRows(buildSchemaRows(loaded.config.keys, opts.env, groups, filters));
  });

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function assertValidOptions(opts: LsOptions, format: LsFormat): void {
  if (opts.check) return assertValidCheckOptions(opts, format);

  if (opts.reveal && !opts.env) fail("--reveal requires --env");
  if (format === "json" && !(opts.reveal && opts.env && opts.map)) {
    fail("--format json requires --reveal, --env, and --map");
  }
}

function assertValidCheckOptions(opts: LsOptions, format: LsFormat): void {
  if (!opts.env) fail("--check requires --env");
  if (opts.reveal) fail("--check cannot be combined with --reveal");
  if (format === "json") fail("--check does not support --format json");
}

interface RevealArgs {
  loaded: Awaited<ReturnType<typeof loadConfig>>;
  env: string;
  groups: string[] | undefined;
  filters: string[] | undefined;
  format: LsFormat;
}

async function runReveal({ loaded, env, groups, filters, format }: RevealArgs): Promise<void> {
  const resolveOpts = {
    config: loaded.config,
    envName: env,
    rootDir: loaded.rootDir,
    registry: createDefaultRegistry(),
    groups,
    filters
  };

  const resolution = await assertValidationPasses(resolveOpts);

  if (format === "json") {
    const vars = buildJsonVars(loaded.appMapping, loaded.config.keys, resolution);
    process.stdout.write(JSON.stringify({ env, vars }, null, 2) + "\n");
    return;
  }

  console.error("warning: revealing secret values");
  printRows(buildRevealedRows(loaded.config.keys, resolution));
}

interface CheckArgs {
  loaded: Awaited<ReturnType<typeof loadConfig>>;
  env: string;
  groups: string[] | undefined;
  filters: string[] | undefined;
}

// Exhaustive validation sweep: resolve every declared key for the given env,
// ignoring app mappings (roots stay undefined => legacy "all keys in scope").
// Required keys that don't resolve fail the sweep; optional ones are reported
// as skipped. Designed for CI gating, so it never reveals resolved values.
async function runCheck({ loaded, env, groups, filters }: CheckArgs): Promise<void> {
  const { topLevelErrors, keyErrors, resolution } = await resolveValidated({
    config: loaded.config,
    envName: env,
    rootDir: loaded.rootDir,
    registry: createDefaultRegistry(),
    groups,
    filters
    // roots intentionally omitted: validate the full config, not the app mapping.
  });

  if (topLevelErrors.length > 0) {
    for (const err of topLevelErrors) console.error(`error: ${err.message}`);
    process.exit(1);
  }

  // resolution is always present once top-level checks pass.
  const skipped = resolution ? reportOptionalSkips(resolution, loaded.config.keys) : 0;

  if (keyErrors.length > 0) {
    console.error(`error: ${keyErrors.length} key(s) failed validation for env "${env}":`);
    for (const err of keyErrors) console.error(`  FAIL ${err.path}: ${err.message}`);
    process.exit(1);
  }

  const suffix = skipped > 0 ? ` (${skipped} optional skipped)` : "";
  console.log(`OK: all required keys resolve for env "${env}"${suffix}`);
}

// Prints a SKIP line for every optional key that didn't resolve and returns
// how many were skipped. Required keys that fail surface as keyErrors instead.
function reportOptionalSkips(resolution: Resolution, records: NormalizedRecord[]): number {
  const optionalPaths = new Set(records.filter((r) => r.optional).map((r) => r.path));
  let skipped = 0;
  for (const status of resolution.statuses) {
    if (status.status === "skipped" && optionalPaths.has(status.path)) {
      console.log(`SKIP ${status.path}: ${formatSkipCause(status.cause)}`);
      skipped += 1;
    }
  }
  return skipped;
}

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

function buildRevealedRows(records: NormalizedRecord[], resolution: Resolution): KeyRow[] {
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

function describeStatus(record: NormalizedRecord, status: KeyResolutionStatus | undefined): string {
  if (status === undefined) return "(missing)";
  switch (status.status) {
    case "resolved":
      return status.value;
    case "filtered":
      return "(filtered)";
    case "skipped":
      return record.optional
        ? "(optional, no value)"
        : `key '${record.path}' ${formatSkipCause(status.cause)}`;
    case "error":
      return `error: ${status.message}`;
  }
}

function describeSource(record: NormalizedRecord, envName: string | undefined): string {
  const binding = envName ? (record.values?.[envName] ?? record.value) : record.value;
  if (record.kind === "secret") return describeSecretBinding(record, binding);
  return describeConfigBinding(record, binding);
}

function describeSecretBinding(record: NormalizedRecord, binding: unknown): string {
  if (binding !== undefined) return `provider: ${(binding as BuiltinProviderRef).name}`;
  return record.optional ? "(optional, no provider)" : "(no provider bound)";
}

function describeConfigBinding(record: NormalizedRecord, binding: unknown): string {
  if (binding !== undefined) return `value: ${formatScalar(binding as ConfigBinding)}`;
  return record.optional ? "(optional, no value)" : "(missing)";
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
  resolution: Resolution
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
