import type { BuiltinProviderRef, NormalizedConfig, NormalizedRecord } from "../../config/types.js";

export interface DesiredBinding {
  keyPath: string;
  envName: string | undefined;
  providerName: string;
  providerParams: unknown;
}

export function collectDesiredBindings(config: NormalizedConfig): DesiredBinding[] {
  const bindings: DesiredBinding[] = [];
  for (const record of config.keys) {
    if (record.kind !== "secret") continue;
    appendRecordBindings(record, config.envs, bindings);
  }
  return bindings;
}

export function collectProviderRefs(record: NormalizedRecord): BuiltinProviderRef[] {
  if (record.kind !== "secret") return [];
  const refs: BuiltinProviderRef[] = [];
  if (record.value !== undefined) refs.push(record.value);
  for (const ref of Object.values(record.values ?? {})) refs.push(ref);
  return refs;
}

function appendRecordBindings(
  record: Extract<NormalizedRecord, { kind: "secret" }>,
  envs: readonly string[],
  out: DesiredBinding[]
): void {
  const envless = record.value;
  const perEnv = record.values ?? {};

  if (envless !== undefined) {
    appendEnvlessBindings(record.path, envless, envs, perEnv, out);
  }

  for (const [envName, ref] of Object.entries(perEnv)) {
    out.push({
      keyPath: record.path,
      envName,
      providerName: ref.name,
      providerParams: ref.options
    });
  }
}

// value/default applies as a fallback for every env not overridden in
// values. For envless storage providers this collapses to a single entry;
// the planner handles the collapse via storageScope.
function appendEnvlessBindings(
  keyPath: string,
  envless: BuiltinProviderRef,
  envs: readonly string[],
  perEnv: Record<string, BuiltinProviderRef>,
  out: DesiredBinding[]
): void {
  for (const env of envsNotInValues(envs, perEnv)) {
    out.push({
      keyPath,
      envName: env,
      providerName: envless.name,
      providerParams: envless.options
    });
  }
}

function envsNotInValues(
  envs: readonly string[],
  perEnv: Record<string, BuiltinProviderRef>
): string[] {
  const overridden = new Map<string, true>();
  for (const env of Object.keys(perEnv)) overridden.set(env, true);
  return envs.filter((env) => !overridden.has(env));
}
