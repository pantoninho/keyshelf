import type { NormalizedConfig } from "../config/types.js";
import type { StoredKey } from "../providers/types.js";
import type { Action, Plan } from "./plan.js";
import { diffInstance } from "./internal/diff.js";
import { appendLeafActions, appendList } from "./internal/emit.js";
import { buildInstances, type InstanceState } from "./internal/instance.js";
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
