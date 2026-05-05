import type {
  Action,
  AmbiguousAction,
  CreateAction,
  DeleteAction,
  NoOpAction,
  RenameAction
} from "../plan.js";
import { envKeyValue, type EnvSet } from "./envs.js";
import type { InstanceState } from "./instance.js";

export type LeafKind = "noop" | "create" | "delete";

export function appendLeafActions(
  actions: Action[],
  state: InstanceState,
  kind: LeafKind,
  byPath: Map<string, EnvSet>
): void {
  for (const [path, envs] of byPath) {
    for (const env of envs) {
      actions.push(buildLeafAction(state.providerName, kind, path, env));
    }
  }
}

function buildLeafAction(
  providerName: string,
  kind: LeafKind,
  path: string,
  env: string
): NoOpAction | CreateAction | DeleteAction {
  return { kind, keyPath: path, envName: envKeyValue(env), providerName };
}

export function appendList<T extends RenameAction | AmbiguousAction>(
  actions: Action[],
  items: T[]
): void {
  for (const item of items) actions.push(item);
}
