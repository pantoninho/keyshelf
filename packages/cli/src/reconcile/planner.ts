import type { BuiltinProviderRef, NormalizedConfig, NormalizedRecord } from "../config/types.js";
import type { StoredKey } from "../providers/types.js";
import type {
  Action,
  AmbiguousAction,
  CreateAction,
  DeleteAction,
  NoOpAction,
  Plan,
  RenameAction
} from "./plan.js";

export type StorageScope = "envless" | "perEnv";

export interface ProviderListing {
  providerName: string;
  providerParams: unknown;
  storageScope: StorageScope;
  keys: StoredKey[];
}

interface DesiredBinding {
  keyPath: string;
  envName: string | undefined;
  providerName: string;
  providerParams: unknown;
}

interface InstanceState {
  providerName: string;
  providerParams: unknown;
  storageScope: StorageScope;
  desired: Map<string, Set<EnvKey>>;
  actual: Map<string, Set<EnvKey>>;
  movedFromByPath: Map<string, string[]>;
}

type EnvKey = string;
const ENVLESS: EnvKey = "\0envless";

function envKey(envName: string | undefined): EnvKey {
  return envName ?? ENVLESS;
}

function envKeyValue(key: EnvKey): string | undefined {
  return key === ENVLESS ? undefined : key;
}

export function planReconciliation(config: NormalizedConfig, listings: ProviderListing[]): Plan {
  const instances = buildInstances(config, listings);
  const actions: Action[] = [];

  for (const instance of instances.values()) {
    actions.push(...planInstance(instance));
  }

  return actions;
}

function buildInstances(
  config: NormalizedConfig,
  listings: ProviderListing[]
): Map<string, InstanceState> {
  const instances = new Map<string, InstanceState>();

  for (const listing of listings) {
    const key = instanceKey(listing.providerName, listing.providerParams);
    const state = ensureInstance(instances, key, listing);
    for (const stored of listing.keys) {
      const envs = upsertSet(state.actual, stored.keyPath);
      envs.add(envKey(stored.envName));
    }
  }

  for (const binding of collectDesiredBindings(config)) {
    const key = instanceKey(binding.providerName, binding.providerParams);
    let state = instances.get(key);
    if (state === undefined) {
      // Desired references an instance with no listing supplied. Treat as
      // empty actual storage — every binding becomes a candidate Create.
      state = {
        providerName: binding.providerName,
        providerParams: binding.providerParams,
        // Default to perEnv when we have no listing to tell us otherwise; an
        // envless-storage instance with zero stored keys behaves the same as
        // a perEnv instance with zero stored keys (everything is a Create).
        storageScope: "perEnv",
        desired: new Map(),
        actual: new Map(),
        movedFromByPath: new Map()
      };
      instances.set(key, state);
    }
    const envSet = upsertSet(state.desired, binding.keyPath);
    envSet.add(state.storageScope === "envless" ? ENVLESS : envKey(binding.envName));
  }

  attachMovedFrom(config, instances);
  return instances;
}

function attachMovedFrom(config: NormalizedConfig, instances: Map<string, InstanceState>): void {
  for (const record of config.keys) {
    if (record.kind !== "secret" || record.movedFrom === undefined) continue;
    const refs = collectProviderRefs(record);
    const seenInstances = new Set<string>();
    for (const ref of refs) {
      const key = instanceKey(ref.name, ref.options);
      if (seenInstances.has(key)) continue;
      seenInstances.add(key);
      const state = instances.get(key);
      if (state === undefined) continue;
      state.movedFromByPath.set(record.path, [...record.movedFrom]);
    }
  }
}

interface InstanceDiff {
  matched: Map<string, Set<EnvKey>>;
  unmetByPath: Map<string, Set<EnvKey>>;
  orphansByPath: Map<string, Set<EnvKey>>;
}

function planInstance(state: InstanceState): Action[] {
  const diff = diffInstance(state);
  const renamePlan = resolveRenames(state, diff.unmetByPath, diff.orphansByPath);

  return [
    ...emitLeafActions(state, "noop", diff.matched),
    ...renamePlan.renames,
    ...renamePlan.ambiguous,
    ...emitLeafActions(state, "create", diff.unmetByPath),
    ...emitLeafActions(state, "delete", diff.orphansByPath)
  ];
}

function diffInstance(state: InstanceState): InstanceDiff {
  const matched = new Map<string, Set<EnvKey>>();
  const unmetByPath = new Map<string, Set<EnvKey>>();
  const orphansByPath = new Map<string, Set<EnvKey>>();

  for (const [path, desiredEnvs] of state.desired) {
    const actualEnvs = state.actual.get(path) ?? new Set<EnvKey>();
    for (const env of desiredEnvs) {
      const bucket = actualEnvs.has(env) ? matched : unmetByPath;
      upsertSet(bucket, path).add(env);
    }
  }

  for (const [path, actualEnvs] of state.actual) {
    const desiredEnvs = state.desired.get(path) ?? new Set<EnvKey>();
    for (const env of actualEnvs) {
      if (!desiredEnvs.has(env)) {
        upsertSet(orphansByPath, path).add(env);
      }
    }
  }

  return { matched, unmetByPath, orphansByPath };
}

type LeafKind = "noop" | "create" | "delete";

function emitLeafActions(
  state: InstanceState,
  kind: LeafKind,
  byPath: Map<string, Set<EnvKey>>
): Array<NoOpAction | CreateAction | DeleteAction> {
  const actions: Array<NoOpAction | CreateAction | DeleteAction> = [];
  for (const [path, envs] of byPath) {
    for (const env of envs) {
      actions.push({
        kind,
        keyPath: path,
        envName: envKeyValue(env),
        providerName: state.providerName
      });
    }
  }
  return actions;
}

interface RenamePlan {
  renames: RenameAction[];
  ambiguous: AmbiguousAction[];
}

interface MatchPools {
  pureCreates: Map<string, Set<EnvKey>>;
  pureOrphans: Map<string, Set<EnvKey>>;
  consumedOrphanPaths: Set<string>;
  consumedDesiredPaths: Set<string>;
}

function resolveRenames(
  state: InstanceState,
  unmetByPath: Map<string, Set<EnvKey>>,
  orphansByPath: Map<string, Set<EnvKey>>
): RenamePlan {
  const renames: RenameAction[] = [];
  const ambiguous: AmbiguousAction[] = [];
  const pools = buildMatchPools(state, unmetByPath, orphansByPath);

  resolveMovedFromMatches(state, pools, renames, unmetByPath, orphansByPath);
  resolveShapeMatches(state, pools, renames, ambiguous, unmetByPath, orphansByPath);

  return { renames, ambiguous };
}

function buildMatchPools(
  state: InstanceState,
  unmetByPath: Map<string, Set<EnvKey>>,
  orphansByPath: Map<string, Set<EnvKey>>
): MatchPools {
  // A path is rename-eligible only when *all* of its desired envs are unmet
  // (no overlap with actual storage at this path) and the path itself does
  // not appear in actual storage. Partial-env mismatches stay as Create.
  const pureCreates = new Map<string, Set<EnvKey>>();
  for (const [path, envs] of unmetByPath) {
    const desiredEnvs = state.desired.get(path) ?? new Set<EnvKey>();
    if (envs.size === desiredEnvs.size && !state.actual.has(path)) {
      pureCreates.set(path, envs);
    }
  }

  // An orphan path is rename-eligible only when it doesn't also appear as
  // desired (e.g. partial overlap stays as Delete).
  const pureOrphans = new Map<string, Set<EnvKey>>();
  for (const [path, envs] of orphansByPath) {
    if (!state.desired.has(path)) {
      pureOrphans.set(path, envs);
    }
  }

  return {
    pureCreates,
    pureOrphans,
    consumedOrphanPaths: new Set(),
    consumedDesiredPaths: new Set()
  };
}

// Pass 1: movedFrom forces a match. Consumes the intersection of desired
// and orphan envs; leftover envs on either side fall through to
// Create/Delete respectively.
function resolveMovedFromMatches(
  state: InstanceState,
  pools: MatchPools,
  renames: RenameAction[],
  unmetByPath: Map<string, Set<EnvKey>>,
  orphansByPath: Map<string, Set<EnvKey>>
): void {
  for (const [desiredPath, desiredEnvs] of pools.pureCreates) {
    const movedFrom = state.movedFromByPath.get(desiredPath);
    if (movedFrom === undefined) continue;
    for (const candidate of movedFrom) {
      if (pools.consumedOrphanPaths.has(candidate)) continue;
      const orphanEnvs = pools.pureOrphans.get(candidate);
      if (orphanEnvs === undefined) continue;
      commitRename(
        state,
        pools,
        renames,
        unmetByPath,
        orphansByPath,
        candidate,
        desiredPath,
        desiredEnvs,
        orphanEnvs
      );
      break;
    }
  }
}

// Pass 2: shape match by envCoverage. Within an instance, providerName and
// providerParams already match by construction, so envCoverage is the only
// remaining shape axis.
function resolveShapeMatches(
  state: InstanceState,
  pools: MatchPools,
  renames: RenameAction[],
  ambiguous: AmbiguousAction[],
  unmetByPath: Map<string, Set<EnvKey>>,
  orphansByPath: Map<string, Set<EnvKey>>
): void {
  for (const [desiredPath, desiredEnvs] of pools.pureCreates) {
    if (pools.consumedDesiredPaths.has(desiredPath)) continue;

    const matches = findShapeMatches(pools, desiredEnvs);
    if (matches.length === 1) {
      const candidate = matches[0];
      const orphanEnvs = pools.pureOrphans.get(candidate);
      // pureOrphans was populated for every entry in `matches` by
      // findShapeMatches, so the lookup is guaranteed to hit. The guard
      // exists to satisfy strict-null without a non-null assertion.
      if (orphanEnvs === undefined) continue;
      commitRename(
        state,
        pools,
        renames,
        unmetByPath,
        orphansByPath,
        candidate,
        desiredPath,
        desiredEnvs,
        orphanEnvs
      );
    } else if (matches.length > 1) {
      ambiguous.push(buildAmbiguous(state, desiredPath, matches));
      // Suppress both sides while ambiguity is unresolved — emitting a
      // Delete on a possibly-renamed path would destroy data.
      unmetByPath.delete(desiredPath);
      pools.consumedDesiredPaths.add(desiredPath);
      for (const path of matches) {
        orphansByPath.delete(path);
        pools.consumedOrphanPaths.add(path);
      }
    }
  }
}

function findShapeMatches(pools: MatchPools, desiredEnvs: Set<EnvKey>): string[] {
  const matches: string[] = [];
  for (const [orphanPath, orphanEnvs] of pools.pureOrphans) {
    if (pools.consumedOrphanPaths.has(orphanPath)) continue;
    if (envSetsEqual(desiredEnvs, orphanEnvs)) {
      matches.push(orphanPath);
    }
  }
  return matches;
}

function commitRename(
  state: InstanceState,
  pools: MatchPools,
  renames: RenameAction[],
  unmetByPath: Map<string, Set<EnvKey>>,
  orphansByPath: Map<string, Set<EnvKey>>,
  fromPath: string,
  toPath: string,
  desiredEnvs: Set<EnvKey>,
  orphanEnvs: Set<EnvKey>
): void {
  const rename = buildRename(state, fromPath, toPath, desiredEnvs, orphanEnvs);
  renames.push(rename);
  consumeEnvs(unmetByPath, toPath, rename.envBindings);
  consumeEnvs(orphansByPath, fromPath, rename.envBindings);
  pools.consumedOrphanPaths.add(fromPath);
  pools.consumedDesiredPaths.add(toPath);
}

function buildAmbiguous(
  state: InstanceState,
  desiredPath: string,
  matches: string[]
): AmbiguousAction {
  return {
    kind: "ambiguous",
    desired: { keyPath: desiredPath, providerName: state.providerName },
    candidates: matches.map((path) => ({
      keyPath: path,
      providerName: state.providerName
    })),
    hint: `Annotate movedFrom: '<old>' on ${desiredPath} to disambiguate.`
  };
}

function consumeEnvs(
  byPath: Map<string, Set<EnvKey>>,
  path: string,
  envs: Array<string | undefined>
): void {
  const set = byPath.get(path);
  if (set === undefined) return;
  for (const env of envs) {
    set.delete(envKey(env));
  }
  if (set.size === 0) byPath.delete(path);
}

function buildRename(
  state: InstanceState,
  fromPath: string,
  toPath: string,
  desiredEnvs: Set<EnvKey>,
  orphanEnvs: Set<EnvKey>
): RenameAction {
  // envBindings is the set of envs the apply step must move bytes for —
  // i.e. the intersection of "envs the desired side wants" and "envs the
  // orphan side actually has". Anything else falls out as Create or Delete
  // on a re-plan after apply.
  const envBindings: Array<string | undefined> = [];
  for (const env of desiredEnvs) {
    if (orphanEnvs.has(env)) envBindings.push(envKeyValue(env));
  }
  envBindings.sort(envSorter);
  return {
    kind: "rename",
    from: { keyPath: fromPath },
    to: { keyPath: toPath },
    providerName: state.providerName,
    envBindings
  };
}

function envSorter(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  return a.localeCompare(b);
}

function envSetsEqual(a: Set<EnvKey>, b: Set<EnvKey>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function collectDesiredBindings(config: NormalizedConfig): DesiredBinding[] {
  const bindings: DesiredBinding[] = [];

  for (const record of config.keys) {
    if (record.kind !== "secret") continue;

    const envless = record.value;
    const perEnv = record.values ?? {};

    if (envless !== undefined) {
      const envsCovered = envsNotInValues(config.envs, perEnv);
      // value/default applies as a fallback for every env not overridden in
      // values. For envless storage providers this collapses to a single
      // entry; the planner handles the collapse via storageScope.
      for (const env of envsCovered) {
        bindings.push({
          keyPath: record.path,
          envName: env,
          providerName: envless.name,
          providerParams: envless.options
        });
      }
      // If perEnv is empty and config.envs is empty (impossible per schema)
      // we'd miss the binding entirely — schema guarantees envs.length >= 1.
    }

    for (const [envName, ref] of Object.entries(perEnv)) {
      bindings.push({
        keyPath: record.path,
        envName,
        providerName: ref.name,
        providerParams: ref.options
      });
    }
  }

  return bindings;
}

function envsNotInValues(
  envs: readonly string[],
  perEnv: Record<string, BuiltinProviderRef>
): string[] {
  const overridden = new Set(Object.keys(perEnv));
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

function ensureInstance(
  instances: Map<string, InstanceState>,
  key: string,
  listing: ProviderListing
): InstanceState {
  let state = instances.get(key);
  if (state === undefined) {
    state = {
      providerName: listing.providerName,
      providerParams: listing.providerParams,
      storageScope: listing.storageScope,
      desired: new Map(),
      actual: new Map(),
      movedFromByPath: new Map()
    };
    instances.set(key, state);
  }
  return state;
}

function upsertSet<K, V>(map: Map<K, Set<V>>, key: K): Set<V> {
  let set = map.get(key);
  if (set === undefined) {
    set = new Set<V>();
    map.set(key, set);
  }
  return set;
}
