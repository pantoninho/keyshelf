import { newEnvSet, type EnvSet } from "./envs.js";
import { upsertEnvSet, type InstanceState } from "./instance.js";

export interface InstanceDiff {
  matched: Map<string, EnvSet>;
  unmetByPath: Map<string, EnvSet>;
  orphansByPath: Map<string, EnvSet>;
}

export function diffInstance(state: InstanceState): InstanceDiff {
  const diff: InstanceDiff = {
    matched: new Map(),
    unmetByPath: new Map(),
    orphansByPath: new Map()
  };
  partitionDesired(state, diff);
  partitionActual(state, diff);
  return diff;
}

function partitionDesired(state: InstanceState, diff: InstanceDiff): void {
  for (const [path, desiredEnvs] of state.desired) {
    const actualEnvs = state.actual.get(path) ?? newEnvSet();
    for (const env of desiredEnvs) {
      const bucket = actualEnvs.has(env) ? diff.matched : diff.unmetByPath;
      upsertEnvSet(bucket, path).add(env);
    }
  }
}

function partitionActual(state: InstanceState, diff: InstanceDiff): void {
  for (const [path, actualEnvs] of state.actual) {
    const desiredEnvs = state.desired.get(path) ?? newEnvSet();
    for (const env of actualEnvs) {
      if (!desiredEnvs.has(env)) {
        upsertEnvSet(diff.orphansByPath, path).add(env);
      }
    }
  }
}
