import { isTemplateMapping, type AppMapping } from "../config/app-mapping.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type {
  BuiltinProviderRef,
  ConfigBinding,
  NormalizedConfig,
  NormalizedRecord
} from "../config/types.js";
import type {
  RenderedEnvVar,
  ResolvedKey,
  SelectedRecord,
  KeyResolutionStatus,
  Resolution,
  SkipCause,
  TopLevelError,
  ValidationResult
} from "./types.js";

export { formatSkipCause } from "./format.js";

const TEMPLATE_RE = /(?<!\$)\$\{([^}]+)\}/g;
const ESCAPED_TEMPLATE_RE = /\$\$\{/g;

export interface ResolveOptions {
  config: NormalizedConfig;
  envName?: string;
  rootDir: string;
  registry: ProviderRegistry;
  groups?: string[];
  filters?: string[];
}

export async function resolve(options: ResolveOptions): Promise<ResolvedKey[]> {
  return (await resolveWithStatus(options)).resolved;
}

export async function validate(options: ResolveOptions): Promise<ValidationResult> {
  const topLevelErrors: TopLevelError[] = [];

  const envError = checkValidEnv(options);
  if (envError !== undefined) topLevelErrors.push(envError);

  const groupCheck = checkGroupFilter(options.config, options.groups);
  topLevelErrors.push(...groupCheck.errors);

  if (topLevelErrors.length > 0) {
    return { topLevelErrors, keyErrors: [] };
  }

  const selected = selectRecords(options.config, options.groups, options.filters);
  const envRequiredError = checkEnvProvidedWhenRequired(selected, options.envName);
  if (envRequiredError !== undefined) {
    return { topLevelErrors: [envRequiredError], keyErrors: [] };
  }

  const resolution = await resolveWithStatus(options);
  const keyErrors = resolution.statuses
    .filter((status): status is Extract<KeyResolutionStatus, { status: "error" }> => {
      return status.status === "error";
    })
    .map((status) => ({
      path: status.path,
      message: status.message,
      error: status.error
    }));

  return { topLevelErrors: [], keyErrors };
}

export async function resolveWithStatus(options: ResolveOptions): Promise<Resolution> {
  assertValidEnv(options);
  const selected = selectRecords(options.config, options.groups, options.filters);
  assertEnvProvidedWhenRequired(selected, options.envName);

  const selectedByPath = new Map(
    selected
      .filter((entry) => entry.selected)
      .map((entry) => [entry.record.path, entry.record] as const)
  );
  const statusByPath = new Map<string, KeyResolutionStatus>();
  const resolving = new Set<string>();

  for (const entry of selected) {
    if (!entry.selected && entry.cause !== undefined) {
      statusByPath.set(entry.record.path, {
        path: entry.record.path,
        status: "filtered",
        cause: entry.cause
      });
    }
  }

  async function resolveRecord(path: string): Promise<KeyResolutionStatus> {
    const existing = statusByPath.get(path);
    if (existing !== undefined) return existing;

    const record = selectedByPath.get(path);
    if (record === undefined) {
      return toErrorStatus(path, new Error(`unknown key reference "${path}"`));
    }

    if (resolving.has(path)) {
      return toErrorStatus(path, new Error(`template cycle detected while resolving "${path}"`));
    }

    resolving.add(path);
    const status = await resolveSelectedRecord(record, options, resolveRecord);
    resolving.delete(path);
    statusByPath.set(path, status);
    return status;
  }

  for (const entry of selected) {
    if (entry.selected) {
      await resolveRecord(entry.record.path);
    }
  }

  const statuses = selected.map((entry) => statusByPath.get(entry.record.path)).filter(isDefined);
  const resolved = statuses
    .filter((status): status is Extract<KeyResolutionStatus, { status: "resolved" }> => {
      return status.status === "resolved";
    })
    .map((status) => ({ path: status.path, value: status.value }));

  return { statuses, resolved, statusByPath };
}

export function renderAppMapping(mappings: AppMapping[], resolution: Resolution): RenderedEnvVar[] {
  const resolvedMap = new Map(resolution.resolved.map((key) => [key.path, key.value]));

  return mappings.map((mapping) => {
    if (isTemplateMapping(mapping)) {
      for (const keyPath of mapping.keyPaths) {
        if (!resolvedMap.has(keyPath)) {
          return skippedEnvVar(mapping.envVar, mapping, keyPath, resolution);
        }
      }

      return {
        envVar: mapping.envVar,
        status: "rendered",
        value: renderTemplate(mapping.template, resolvedMap),
        mapping
      };
    }

    const value = resolvedMap.get(mapping.keyPath);
    if (value === undefined) {
      return skippedEnvVar(mapping.envVar, mapping, mapping.keyPath, resolution);
    }

    return {
      envVar: mapping.envVar,
      status: "rendered",
      value,
      mapping
    };
  });
}

function selectRecords(
  config: NormalizedConfig,
  groups: string[] | undefined,
  filters: string[] | undefined
): SelectedRecord[] {
  const groupSet = normalizeGroupFilter(config, groups);
  const activeGroups = [...groupSet];
  const pathPrefixes = normalizePathFilters(filters);

  return config.keys.map((record) => {
    if (isExcludedByGroup(record, groupSet)) {
      return {
        record,
        selected: false,
        cause: { type: "group-filter", activeGroups }
      };
    }
    if (isExcludedByPath(record, pathPrefixes)) {
      return {
        record,
        selected: false,
        cause: { type: "path-filter", activePrefixes: pathPrefixes }
      };
    }
    return { record, selected: true };
  });
}

function normalizeGroupFilter(config: NormalizedConfig, groups: string[] | undefined): Set<string> {
  const { errors, groupSet } = checkGroupFilter(config, groups);
  if (errors.length > 0) throw new Error(errors[0].message);
  return groupSet;
}

function checkGroupFilter(
  config: NormalizedConfig,
  groups: string[] | undefined
): { errors: TopLevelError[]; groupSet: Set<string> } {
  const groupNames = [...new Set(groups ?? [])];
  if (groupNames.length === 0) return { errors: [], groupSet: new Set() };

  if (config.groups.length === 0) {
    return {
      errors: [{ message: "--group cannot be used because this config declares no groups" }],
      groupSet: new Set()
    };
  }

  const declaredGroups = new Set(config.groups);
  const errors: TopLevelError[] = [];
  for (const group of groupNames) {
    if (!declaredGroups.has(group)) {
      errors.push({ message: `Unknown group "${group}"` });
    }
  }

  return { errors, groupSet: new Set(groupNames.filter((g) => declaredGroups.has(g))) };
}

function normalizePathFilters(filters: string[] | undefined): string[] {
  return [...new Set(filters ?? [])].filter((filter) => filter.length > 0);
}

function isExcludedByGroup(record: NormalizedRecord, groupSet: Set<string>): boolean {
  if (groupSet.size === 0) return false;
  if (record.group === undefined) return false;
  return !groupSet.has(record.group);
}

function isExcludedByPath(record: NormalizedRecord, prefixes: string[]): boolean {
  if (prefixes.length === 0) return false;
  return !prefixes.some((prefix) => matchesPathPrefix(record.path, prefix));
}

function matchesPathPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function assertValidEnv(options: ResolveOptions): void {
  const error = checkValidEnv(options);
  if (error !== undefined) throw new Error(error.message);
}

function checkValidEnv(options: ResolveOptions): TopLevelError | undefined {
  if (options.envName === undefined) return undefined;
  if (options.config.envs.includes(options.envName)) return undefined;
  return { message: `Unknown env "${options.envName}"` };
}

function assertEnvProvidedWhenRequired(
  selected: SelectedRecord[],
  envName: string | undefined
): void {
  const error = checkEnvProvidedWhenRequired(selected, envName);
  if (error !== undefined) throw new Error(error.message);
}

function checkEnvProvidedWhenRequired(
  selected: SelectedRecord[],
  envName: string | undefined
): TopLevelError | undefined {
  if (envName !== undefined) return undefined;

  const envScopedRecord = selected
    .filter((entry) => entry.selected)
    .map((entry) => entry.record)
    .find((record) => hasValuesWithoutFallback(record));

  if (envScopedRecord === undefined) return undefined;
  return {
    message: `--env is required because selected key "${envScopedRecord.path}" has env-specific values and no fallback`
  };
}

function hasValuesWithoutFallback(record: NormalizedRecord): boolean {
  return record.value === undefined && Object.keys(record.values ?? {}).length > 0;
}

async function resolveSelectedRecord(
  record: NormalizedRecord,
  options: ResolveOptions,
  resolveRecord: (path: string) => Promise<KeyResolutionStatus>
): Promise<KeyResolutionStatus> {
  const binding = getActiveBinding(record, options.envName);
  if (binding === undefined) {
    if (record.optional) {
      return {
        path: record.path,
        status: "skipped",
        cause: { type: "optional-no-value" }
      };
    }
    return toErrorStatus(record.path, new Error(`No value for required key "${record.path}"`));
  }

  try {
    const value =
      record.kind === "secret"
        ? await resolveProvider(record.path, binding as BuiltinProviderRef, options)
        : await resolveConfigBinding(record.path, binding as ConfigBinding, resolveRecord);
    return { path: record.path, status: "resolved", value };
  } catch (err) {
    if (err instanceof FilteredTemplateReferenceError) {
      return {
        path: record.path,
        status: "skipped",
        cause: {
          type: "template-ref-unavailable",
          reference: err.reference,
          referenceCause: err.referenceCause
        }
      };
    }
    if (record.optional && isNotFoundError(err)) {
      return {
        path: record.path,
        status: "skipped",
        cause: { type: "optional-not-found" }
      };
    }
    return toErrorStatus(record.path, err);
  }
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

async function resolveProvider(
  keyPath: string,
  providerRef: BuiltinProviderRef,
  options: ResolveOptions
): Promise<string> {
  const provider = options.registry.get(providerRef.name);
  return provider.resolve({
    keyPath,
    envName: options.envName,
    rootDir: options.rootDir,
    config: { ...(providerRef.options as unknown as Record<string, unknown>) },
    keyshelfName: options.config.name
  });
}

async function resolveConfigBinding(
  path: string,
  binding: ConfigBinding,
  resolveRecord: (path: string) => Promise<KeyResolutionStatus>
): Promise<string> {
  if (typeof binding !== "string") return String(binding);
  return interpolateConfigTemplate(path, binding, resolveRecord);
}

async function interpolateConfigTemplate(
  path: string,
  template: string,
  resolveRecord: (path: string) => Promise<KeyResolutionStatus>
): Promise<string> {
  const replacements = new Map<string, string>();

  TEMPLATE_RE.lastIndex = 0;
  for (const match of template.matchAll(TEMPLATE_RE)) {
    const reference = match[1].trim();
    const status = await resolveRecord(reference);

    if (status.status === "resolved") {
      replacements.set(reference, status.value);
      continue;
    }

    if (status.status === "filtered" || status.status === "skipped") {
      throw new FilteredTemplateReferenceError(path, reference, status.cause);
    }

    throw new Error(`referenced key "${reference}" could not be resolved: ${status.message}`);
  }

  TEMPLATE_RE.lastIndex = 0;
  return template
    .replace(TEMPLATE_RE, (_, keyPath: string) => replacements.get(keyPath.trim()) ?? "")
    .replace(ESCAPED_TEMPLATE_RE, "${");
}

function renderTemplate(template: string, resolvedMap: Map<string, string>): string {
  TEMPLATE_RE.lastIndex = 0;
  return template
    .replace(TEMPLATE_RE, (_, keyPath: string) => resolvedMap.get(keyPath.trim()) ?? "")
    .replace(ESCAPED_TEMPLATE_RE, "${");
}

function skippedEnvVar(
  envVar: string,
  mapping: AppMapping,
  keyPath: string,
  resolution: Resolution
): RenderedEnvVar {
  const status = resolution.statusByPath.get(keyPath);
  return {
    envVar,
    status: "skipped",
    keyPath,
    cause: statusToSkipCause(status),
    mapping
  };
}

function statusToSkipCause(status: KeyResolutionStatus | undefined): SkipCause {
  if (status?.status === "filtered" || status?.status === "skipped") return status.cause;
  // Defensive fallback — shouldn't be reached with a validated config.
  return { type: "optional-no-value" };
}

class FilteredTemplateReferenceError extends Error {
  constructor(
    readonly keyPath: string,
    readonly reference: string,
    readonly referenceCause: SkipCause
  ) {
    super(`referenced key "${reference}" is unavailable for "${keyPath}"`);
  }
}

function toErrorStatus(path: string, err: unknown): KeyResolutionStatus {
  return {
    path,
    status: "error",
    message: err instanceof Error ? err.message : String(err),
    error: err instanceof Error ? err : undefined
  };
}

function isNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /(^|[^a-z])not[ _-]?found([^a-z]|$)|NOT_FOUND/.test(message);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
