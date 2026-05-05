import type { AmbiguousAction, RenameAction } from "../plan.js";
import { envKey, envKeyValue, envSetsEqual, envSorter, type EnvSet } from "./envs.js";
import type { InstanceState } from "./instance.js";

export interface RenamePlan {
  renames: RenameAction[];
  ambiguous: AmbiguousAction[];
}

interface MatchPools {
  pureCreates: Map<string, EnvSet>;
  pureOrphans: Map<string, EnvSet>;
  consumedOrphanPaths: Map<string, true>;
  consumedDesiredPaths: Map<string, true>;
}

export function resolveRenames(
  state: InstanceState,
  unmetByPath: Map<string, EnvSet>,
  orphansByPath: Map<string, EnvSet>
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
  unmetByPath: Map<string, EnvSet>,
  orphansByPath: Map<string, EnvSet>
): MatchPools {
  return {
    pureCreates: collectPureCreates(state, unmetByPath),
    pureOrphans: collectPureOrphans(state, orphansByPath),
    consumedOrphanPaths: new Map(),
    consumedDesiredPaths: new Map()
  };
}

// A path is rename-eligible only when *all* of its desired envs are unmet
// (no overlap with actual storage at this path) and the path itself does
// not appear in actual storage. Partial-env mismatches stay as Create.
function collectPureCreates(
  state: InstanceState,
  unmetByPath: Map<string, EnvSet>
): Map<string, EnvSet> {
  const pureCreates = new Map<string, EnvSet>();
  for (const [path, envs] of unmetByPath) {
    const desiredEnvs = state.desired.get(path);
    if (desiredEnvs === undefined) continue;
    if (envs.size === desiredEnvs.size && !state.actual.has(path)) {
      pureCreates.set(path, envs);
    }
  }
  return pureCreates;
}

// An orphan path is rename-eligible only when it doesn't also appear as
// desired (e.g. partial overlap stays as Delete).
function collectPureOrphans(
  state: InstanceState,
  orphansByPath: Map<string, EnvSet>
): Map<string, EnvSet> {
  const pureOrphans = new Map<string, EnvSet>();
  for (const [path, envs] of orphansByPath) {
    if (!state.desired.has(path)) {
      pureOrphans.set(path, envs);
    }
  }
  return pureOrphans;
}

// Pass 1: movedFrom forces a match. Consumes the intersection of desired
// and orphan envs; leftover envs on either side fall through to
// Create/Delete respectively.
function resolveMovedFromMatches(
  state: InstanceState,
  pools: MatchPools,
  renames: RenameAction[],
  unmetByPath: Map<string, EnvSet>,
  orphansByPath: Map<string, EnvSet>
): void {
  for (const [desiredPath, desiredEnvs] of pools.pureCreates) {
    const movedFrom = state.movedFromByPath.get(desiredPath);
    if (movedFrom === undefined) continue;
    tryMovedFromMatch(
      state,
      pools,
      renames,
      unmetByPath,
      orphansByPath,
      desiredPath,
      desiredEnvs,
      movedFrom
    );
  }
}

function tryMovedFromMatch(
  state: InstanceState,
  pools: MatchPools,
  renames: RenameAction[],
  unmetByPath: Map<string, EnvSet>,
  orphansByPath: Map<string, EnvSet>,
  desiredPath: string,
  desiredEnvs: EnvSet,
  movedFrom: readonly string[]
): void {
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
    return;
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
  unmetByPath: Map<string, EnvSet>,
  orphansByPath: Map<string, EnvSet>
): void {
  for (const [desiredPath, desiredEnvs] of pools.pureCreates) {
    if (pools.consumedDesiredPaths.has(desiredPath)) continue;
    resolveSingleShapeMatch(
      state,
      pools,
      renames,
      ambiguous,
      unmetByPath,
      orphansByPath,
      desiredPath,
      desiredEnvs
    );
  }
}

function resolveSingleShapeMatch(
  state: InstanceState,
  pools: MatchPools,
  renames: RenameAction[],
  ambiguous: AmbiguousAction[],
  unmetByPath: Map<string, EnvSet>,
  orphansByPath: Map<string, EnvSet>,
  desiredPath: string,
  desiredEnvs: EnvSet
): void {
  const matches = findShapeMatches(pools, desiredEnvs);
  if (matches.length === 0) return;
  if (matches.length === 1) {
    commitShapeRename(
      state,
      pools,
      renames,
      unmetByPath,
      orphansByPath,
      desiredPath,
      desiredEnvs,
      matches[0]
    );
    return;
  }
  ambiguous.push(buildAmbiguous(state, desiredPath, matches));
  // Suppress both sides while ambiguity is unresolved — emitting a
  // Delete on a possibly-renamed path would destroy data.
  unmetByPath.delete(desiredPath);
  pools.consumedDesiredPaths.set(desiredPath, true);
  for (const path of matches) {
    orphansByPath.delete(path);
    pools.consumedOrphanPaths.set(path, true);
  }
}

function commitShapeRename(
  state: InstanceState,
  pools: MatchPools,
  renames: RenameAction[],
  unmetByPath: Map<string, EnvSet>,
  orphansByPath: Map<string, EnvSet>,
  desiredPath: string,
  desiredEnvs: EnvSet,
  candidate: string
): void {
  const orphanEnvs = pools.pureOrphans.get(candidate);
  // pureOrphans was populated for every entry in `matches` by
  // findShapeMatches, so the lookup is guaranteed to hit. The guard
  // exists to satisfy strict-null without a non-null assertion.
  if (orphanEnvs === undefined) return;
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
}

function findShapeMatches(pools: MatchPools, desiredEnvs: EnvSet): string[] {
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
  unmetByPath: Map<string, EnvSet>,
  orphansByPath: Map<string, EnvSet>,
  fromPath: string,
  toPath: string,
  desiredEnvs: EnvSet,
  orphanEnvs: EnvSet
): void {
  const rename = buildRename(state, fromPath, toPath, desiredEnvs, orphanEnvs);
  renames.push(rename);
  consumeEnvs(unmetByPath, toPath, rename.envBindings);
  consumeEnvs(orphansByPath, fromPath, rename.envBindings);
  pools.consumedOrphanPaths.set(fromPath, true);
  pools.consumedDesiredPaths.set(toPath, true);
}

function buildAmbiguous(
  state: InstanceState,
  desiredPath: string,
  matches: string[]
): AmbiguousAction {
  const candidates = [];
  for (const keyPath of matches) {
    candidates.push({ keyPath, providerName: state.providerName });
  }
  return {
    kind: "ambiguous",
    desired: { keyPath: desiredPath, providerName: state.providerName },
    candidates,
    hint: `Annotate movedFrom: '<old>' on ${desiredPath} to disambiguate.`
  };
}

function consumeEnvs(
  byPath: Map<string, EnvSet>,
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
  desiredEnvs: EnvSet,
  orphanEnvs: EnvSet
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
