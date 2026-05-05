import type { NormalizedConfig } from "../config/types.js";
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
import { envKeyValue, newEnvSet, type EnvSet } from "./internal/envs.js";
import { buildInstances, upsertEnvSet, type InstanceState } from "./internal/instance.js";
import { resolveRenames } from "./internal/rename.js";

export type StorageScope = "envless" | "perEnv";

export interface ProviderListing {
  providerName: string;
  providerParams: unknown;
  storageScope: StorageScope;
  keys: StoredKey[];
}

export function planReconciliation(config: NormalizedConfig, listings: ProviderListing[]): Plan {
  const instances = buildInstances(config, listings);
  const actions: Action[] = [];
  for (const instance of instances.values()) {
    appendInstanceActions(actions, instance);
  }
  return actions;
}

function appendInstanceActions(actions: Action[], state: InstanceState): void {
  const diff = diffInstance(state);
  const renamePlan = resolveRenames(state, diff.unmetByPath, diff.orphansByPath);
  appendLeafActions(actions, state, "noop", diff.matched);
  appendList(actions, renamePlan.renames);
  appendList(actions, renamePlan.ambiguous);
  appendLeafActions(actions, state, "create", diff.unmetByPath);
  appendLeafActions(actions, state, "delete", diff.orphansByPath);
}

interface InstanceDiff {
  matched: Map<string, EnvSet>;
  unmetByPath: Map<string, EnvSet>;
  orphansByPath: Map<string, EnvSet>;
}

function diffInstance(state: InstanceState): InstanceDiff {
  const matched = new Map<string, EnvSet>();
  const unmetByPath = new Map<string, EnvSet>();
  const orphansByPath = new Map<string, EnvSet>();

  for (const [path, desiredEnvs] of state.desired) {
    const actualEnvs = state.actual.get(path) ?? newEnvSet();
    for (const env of desiredEnvs) {
      const bucket = actualEnvs.has(env) ? matched : unmetByPath;
      upsertEnvSet(bucket, path).add(env);
    }
  }

  for (const [path, actualEnvs] of state.actual) {
    const desiredEnvs = state.desired.get(path) ?? newEnvSet();
    for (const env of actualEnvs) {
      if (!desiredEnvs.has(env)) {
        upsertEnvSet(orphansByPath, path).add(env);
      }
    }
  }

  return { matched, unmetByPath, orphansByPath };
}

type LeafKind = "noop" | "create" | "delete";

function appendLeafActions(
  actions: Action[],
  state: InstanceState,
  kind: LeafKind,
  byPath: Map<string, EnvSet>
): void {
  for (const [path, envs] of byPath) {
    for (const env of envs) {
      actions.push(buildLeafAction(state, kind, path, env));
    }
  }
}

function buildLeafAction(
  state: InstanceState,
  kind: LeafKind,
  path: string,
  env: string
): NoOpAction | CreateAction | DeleteAction {
  return {
    kind,
    keyPath: path,
    envName: envKeyValue(env),
    providerName: state.providerName
  };
}

function appendList<T extends RenameAction | AmbiguousAction>(actions: Action[], items: T[]): void {
  for (const item of items) actions.push(item);
}
