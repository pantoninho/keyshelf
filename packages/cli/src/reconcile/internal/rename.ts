import type { AmbiguousAction, RenameAction } from "../plan.js";
import { envKey, envKeyValue, envSetsEqual, envSorter, type EnvSet } from "./envs.js";
import type { InstanceState } from "./instance.js";

export interface RenamePlan {
  renames: RenameAction[];
  ambiguous: AmbiguousAction[];
}

export function resolveRenames(
  state: InstanceState,
  unmetByPath: Map<string, EnvSet>,
  orphansByPath: Map<string, EnvSet>
): RenamePlan {
  const resolver = new RenameResolver(state, unmetByPath, orphansByPath);
  return resolver.resolve();
}

class RenameResolver {
  readonly renames: RenameAction[] = [];
  readonly ambiguous: AmbiguousAction[] = [];
  readonly pureCreates: Map<string, EnvSet>;
  readonly pureOrphans: Map<string, EnvSet>;
  readonly consumedOrphanPaths = new Map<string, true>();
  readonly consumedDesiredPaths = new Map<string, true>();

  constructor(
    readonly state: InstanceState,
    readonly unmetByPath: Map<string, EnvSet>,
    readonly orphansByPath: Map<string, EnvSet>
  ) {
    this.pureCreates = this.collectPureCreates();
    this.pureOrphans = this.collectPureOrphans();
  }

  resolve(): RenamePlan {
    this.resolveMovedFromMatches();
    this.resolveShapeMatches();
    return { renames: this.renames, ambiguous: this.ambiguous };
  }

  // A path is rename-eligible only when *all* of its desired envs are unmet
  // (no overlap with actual storage at this path) and the path itself does
  // not appear in actual storage. Partial-env mismatches stay as Create.
  private collectPureCreates(): Map<string, EnvSet> {
    const out = new Map<string, EnvSet>();
    for (const [path, envs] of this.unmetByPath) {
      const desiredEnvs = this.state.desired.get(path);
      if (desiredEnvs === undefined) continue;
      if (envs.size === desiredEnvs.size && !this.state.actual.has(path)) {
        out.set(path, envs);
      }
    }
    return out;
  }

  // An orphan path is rename-eligible only when it doesn't also appear as
  // desired (e.g. partial overlap stays as Delete).
  private collectPureOrphans(): Map<string, EnvSet> {
    const out = new Map<string, EnvSet>();
    for (const [path, envs] of this.orphansByPath) {
      if (!this.state.desired.has(path)) {
        out.set(path, envs);
      }
    }
    return out;
  }

  // Pass 1: movedFrom forces a match. Consumes the intersection of desired
  // and orphan envs; leftover envs on either side fall through to
  // Create/Delete respectively.
  private resolveMovedFromMatches(): void {
    for (const [desiredPath, desiredEnvs] of this.pureCreates) {
      const movedFrom = this.state.movedFromByPath.get(desiredPath);
      if (movedFrom === undefined) continue;
      this.tryMovedFromMatch(desiredPath, desiredEnvs, movedFrom);
    }
  }

  private tryMovedFromMatch(
    desiredPath: string,
    desiredEnvs: EnvSet,
    movedFrom: readonly string[]
  ): void {
    for (const candidate of movedFrom) {
      if (this.consumedOrphanPaths.has(candidate)) continue;
      const orphanEnvs = this.pureOrphans.get(candidate);
      if (orphanEnvs === undefined) continue;
      this.commitRename(candidate, desiredPath, desiredEnvs, orphanEnvs);
      return;
    }
  }

  // Pass 2: shape match by envCoverage. Within an instance, providerName and
  // providerParams already match by construction, so envCoverage is the only
  // remaining shape axis.
  private resolveShapeMatches(): void {
    for (const [desiredPath, desiredEnvs] of this.pureCreates) {
      if (this.consumedDesiredPaths.has(desiredPath)) continue;
      this.resolveSingleShapeMatch(desiredPath, desiredEnvs);
    }
  }

  private resolveSingleShapeMatch(desiredPath: string, desiredEnvs: EnvSet): void {
    const matches = this.findShapeMatches(desiredEnvs);
    if (matches.length === 0) return;
    if (matches.length === 1) {
      this.commitShapeRename(desiredPath, desiredEnvs, matches[0]);
      return;
    }
    this.recordAmbiguous(desiredPath, matches);
  }

  private commitShapeRename(desiredPath: string, desiredEnvs: EnvSet, candidate: string): void {
    const orphanEnvs = this.pureOrphans.get(candidate);
    // pureOrphans was populated for every entry in `matches` by
    // findShapeMatches, so the lookup is guaranteed to hit. The guard
    // exists to satisfy strict-null without a non-null assertion.
    if (orphanEnvs === undefined) return;
    this.commitRename(candidate, desiredPath, desiredEnvs, orphanEnvs);
  }

  // Suppress both sides while ambiguity is unresolved — emitting a
  // Delete on a possibly-renamed path would destroy data.
  private recordAmbiguous(desiredPath: string, matches: string[]): void {
    this.ambiguous.push(buildAmbiguous(this.state.providerName, desiredPath, matches));
    this.unmetByPath.delete(desiredPath);
    this.consumedDesiredPaths.set(desiredPath, true);
    for (const path of matches) {
      this.orphansByPath.delete(path);
      this.consumedOrphanPaths.set(path, true);
    }
  }

  private findShapeMatches(desiredEnvs: EnvSet): string[] {
    const matches: string[] = [];
    for (const [orphanPath, orphanEnvs] of this.pureOrphans) {
      if (this.consumedOrphanPaths.has(orphanPath)) continue;
      if (envSetsEqual(desiredEnvs, orphanEnvs)) {
        matches.push(orphanPath);
      }
    }
    return matches;
  }

  private commitRename(
    fromPath: string,
    toPath: string,
    desiredEnvs: EnvSet,
    orphanEnvs: EnvSet
  ): void {
    const rename = buildRename(this.state.providerName, fromPath, toPath, desiredEnvs, orphanEnvs);
    this.renames.push(rename);
    consumeEnvs(this.unmetByPath, toPath, rename.envBindings);
    consumeEnvs(this.orphansByPath, fromPath, rename.envBindings);
    this.consumedOrphanPaths.set(fromPath, true);
    this.consumedDesiredPaths.set(toPath, true);
  }
}

function buildAmbiguous(
  providerName: string,
  desiredPath: string,
  matches: string[]
): AmbiguousAction {
  const candidates = [];
  for (const keyPath of matches) {
    candidates.push({ keyPath, providerName });
  }
  return {
    kind: "ambiguous",
    desired: { keyPath: desiredPath, providerName },
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
  providerName: string,
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
    providerName,
    envBindings
  };
}
