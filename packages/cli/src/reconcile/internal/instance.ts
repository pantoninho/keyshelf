import type { BuiltinProviderRef, NormalizedConfig, NormalizedRecord } from "../../config/types.js";
import type { ProviderListing, StorageScope } from "../planner.js";
import { ENVLESS, envKey, newEnvSet, type EnvSet } from "./envs.js";

export interface InstanceState {
  providerName: string;
  providerParams: unknown;
  storageScope: StorageScope;
  desired: Map<string, EnvSet>;
  actual: Map<string, EnvSet>;
  movedFromByPath: Map<string, string[]>;
}

export interface DesiredBinding {
  keyPath: string;
  envName: string | undefined;
  providerName: string;
  providerParams: unknown;
}

export function buildInstances(
  config: NormalizedConfig,
  listings: ProviderListing[]
): Map<string, InstanceState> {
  const instances = new Map<string, InstanceState>();

  for (const listing of listings) {
    const key = instanceKey(listing.providerName, listing.providerParams);
    const state = ensureInstance(instances, key, listing);
    for (const stored of listing.keys) {
      const envs = upsertEnvSet(state.actual, stored.keyPath);
      envs.add(envKey(stored.envName));
    }
  }

  for (const binding of collectDesiredBindings(config)) {
    const key = instanceKey(binding.providerName, binding.providerParams);
    const state = ensureSyntheticInstance(instances, key, binding);
    const envSet = upsertEnvSet(state.desired, binding.keyPath);
    const env = state.storageScope === "envless" ? ENVLESS : envKey(binding.envName);
    envSet.add(env);
  }

  attachMovedFrom(config, instances);
  return instances;
}

export function upsertEnvSet(map: Map<string, EnvSet>, key: string): EnvSet {
  let envs = map.get(key);
  if (envs === undefined) {
    envs = newEnvSet();
    map.set(key, envs);
  }
  return envs;
}

function ensureInstance(
  instances: Map<string, InstanceState>,
  key: string,
  listing: ProviderListing
): InstanceState {
  const existing = instances.get(key);
  if (existing !== undefined) return existing;
  const state: InstanceState = {
    providerName: listing.providerName,
    providerParams: listing.providerParams,
    storageScope: listing.storageScope,
    desired: new Map(),
    actual: new Map(),
    movedFromByPath: new Map()
  };
  instances.set(key, state);
  return state;
}

function ensureSyntheticInstance(
  instances: Map<string, InstanceState>,
  key: string,
  binding: DesiredBinding
): InstanceState {
  const existing = instances.get(key);
  if (existing !== undefined) return existing;
  // Desired references an instance with no listing supplied. Treat as
  // empty actual storage — every binding becomes a candidate Create.
  // Default to perEnv when we have no listing to tell us otherwise; an
  // envless-storage instance with zero stored keys behaves the same as
  // a perEnv instance with zero stored keys (everything is a Create).
  const state: InstanceState = {
    providerName: binding.providerName,
    providerParams: binding.providerParams,
    storageScope: "perEnv",
    desired: new Map(),
    actual: new Map(),
    movedFromByPath: new Map()
  };
  instances.set(key, state);
  return state;
}

function attachMovedFrom(config: NormalizedConfig, instances: Map<string, InstanceState>): void {
  for (const record of config.keys) {
    if (record.kind !== "secret" || record.movedFrom === undefined) continue;
    attachMovedFromForRecord(record, record.movedFrom, instances);
  }
}

function attachMovedFromForRecord(
  record: NormalizedRecord,
  movedFrom: readonly string[],
  instances: Map<string, InstanceState>
): void {
  const refs = collectProviderRefs(record);
  const seenInstances = new Map<string, true>();
  for (const ref of refs) {
    const key = instanceKey(ref.name, ref.options);
    if (seenInstances.has(key)) continue;
    seenInstances.set(key, true);
    const state = instances.get(key);
    if (state === undefined) continue;
    state.movedFromByPath.set(record.path, [...movedFrom]);
  }
}

function collectDesiredBindings(config: NormalizedConfig): DesiredBinding[] {
  const bindings: DesiredBinding[] = [];

  for (const record of config.keys) {
    if (record.kind !== "secret") continue;
    appendRecordBindings(record, config.envs, bindings);
  }

  return bindings;
}

function appendRecordBindings(
  record: Extract<NormalizedRecord, { kind: "secret" }>,
  envs: readonly string[],
  out: DesiredBinding[]
): void {
  const envless = record.value;
  const perEnv = record.values ?? {};

  if (envless !== undefined) {
    // value/default applies as a fallback for every env not overridden in
    // values. For envless storage providers this collapses to a single
    // entry; the planner handles the collapse via storageScope.
    for (const env of envsNotInValues(envs, perEnv)) {
      out.push({
        keyPath: record.path,
        envName: env,
        providerName: envless.name,
        providerParams: envless.options
      });
    }
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

function envsNotInValues(
  envs: readonly string[],
  perEnv: Record<string, BuiltinProviderRef>
): string[] {
  const overridden = new Map<string, true>();
  for (const env of Object.keys(perEnv)) overridden.set(env, true);
  return envs.filter((env) => !overridden.has(env));
}

function collectProviderRefs(record: NormalizedRecord): BuiltinProviderRef[] {
  if (record.kind !== "secret") return [];
  const refs: BuiltinProviderRef[] = [];
  if (record.value !== undefined) refs.push(record.value);
  for (const ref of Object.values(record.values ?? {})) refs.push(ref);
  return refs;
}

function instanceKey(providerName: string, providerParams: unknown): string {
  return `${providerName}:${stableStringify(providerParams)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}
