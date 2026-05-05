import type { NormalizedConfig, NormalizedRecord } from "../../config/types.js";
import type { ProviderListing, StorageScope } from "../planner.js";
import { ENVLESS, envKey, newEnvSet, type EnvSet } from "./envs.js";
import {
  collectDesiredBindings,
  collectProviderRefs,
  type DesiredBinding
} from "./desired-bindings.js";
import { instanceKey } from "./instance-key.js";

export interface InstanceState {
  providerName: string;
  providerParams: unknown;
  storageScope: StorageScope;
  desired: Map<string, EnvSet>;
  actual: Map<string, EnvSet>;
  movedFromByPath: Map<string, string[]>;
}

export function buildInstances(
  config: NormalizedConfig,
  listings: ProviderListing[]
): Map<string, InstanceState> {
  const builder = new InstanceBuilder();
  builder.applyListings(listings);
  builder.applyDesired(config);
  builder.applyMovedFrom(config);
  return builder.instances;
}

export function upsertEnvSet(map: Map<string, EnvSet>, key: string): EnvSet {
  let envs = map.get(key);
  if (envs === undefined) {
    envs = newEnvSet();
    map.set(key, envs);
  }
  return envs;
}

class InstanceBuilder {
  readonly instances = new Map<string, InstanceState>();

  applyListings(listings: ProviderListing[]): void {
    for (const listing of listings) {
      const key = instanceKey(listing.providerName, listing.providerParams);
      const state = this.ensureFromListing(key, listing);
      for (const stored of listing.keys) {
        const envs = upsertEnvSet(state.actual, stored.keyPath);
        envs.add(envKey(stored.envName));
      }
    }
  }

  applyDesired(config: NormalizedConfig): void {
    for (const binding of collectDesiredBindings(config)) {
      const key = instanceKey(binding.providerName, binding.providerParams);
      const state = this.ensureFromBinding(key, binding);
      const envSet = upsertEnvSet(state.desired, binding.keyPath);
      const env = state.storageScope === "envless" ? ENVLESS : envKey(binding.envName);
      envSet.add(env);
    }
  }

  applyMovedFrom(config: NormalizedConfig): void {
    for (const record of config.keys) {
      if (record.kind !== "secret" || record.movedFrom === undefined) continue;
      this.attachMovedFromForRecord(record, record.movedFrom);
    }
  }

  private ensureFromListing(key: string, listing: ProviderListing): InstanceState {
    const existing = this.instances.get(key);
    if (existing !== undefined) return existing;
    const state: InstanceState = {
      providerName: listing.providerName,
      providerParams: listing.providerParams,
      storageScope: listing.storageScope,
      desired: new Map(),
      actual: new Map(),
      movedFromByPath: new Map()
    };
    this.instances.set(key, state);
    return state;
  }

  // Desired references an instance with no listing supplied. Treat as
  // empty actual storage — every binding becomes a candidate Create.
  // Default to perEnv when we have no listing to tell us otherwise; an
  // envless-storage instance with zero stored keys behaves the same as
  // a perEnv instance with zero stored keys (everything is a Create).
  private ensureFromBinding(key: string, binding: DesiredBinding): InstanceState {
    const existing = this.instances.get(key);
    if (existing !== undefined) return existing;
    const state: InstanceState = {
      providerName: binding.providerName,
      providerParams: binding.providerParams,
      storageScope: "perEnv",
      desired: new Map(),
      actual: new Map(),
      movedFromByPath: new Map()
    };
    this.instances.set(key, state);
    return state;
  }

  private attachMovedFromForRecord(record: NormalizedRecord, movedFrom: readonly string[]): void {
    const refs = collectProviderRefs(record);
    const seenInstances = new Map<string, true>();
    for (const ref of refs) {
      const key = instanceKey(ref.name, ref.options);
      if (seenInstances.has(key)) continue;
      seenInstances.set(key, true);
      const state = this.instances.get(key);
      if (state === undefined) continue;
      state.movedFromByPath.set(record.path, [...movedFrom]);
    }
  }
}
