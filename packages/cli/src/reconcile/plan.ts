export interface KeyLocation {
  keyPath: string;
  envName: string | undefined;
  providerName: string;
}

export interface CreateAction {
  kind: "create";
  keyPath: string;
  envName: string | undefined;
  providerName: string;
}

export interface RenameAction {
  kind: "rename";
  from: { keyPath: string };
  to: { keyPath: string };
  providerName: string;
  // Provider params for the instance both endpoints belong to. Apply uses
  // this to construct the ProviderContext that copy/delete need; the
  // formatter ignores it.
  providerParams: unknown;
  envBindings: Array<string | undefined>;
}

export interface DeleteAction {
  kind: "delete";
  keyPath: string;
  envName: string | undefined;
  providerName: string;
  // Provider params for the instance the orphan belongs to. Apply uses
  // this to scope the delete to the correct instance.
  providerParams: unknown;
}

export interface NoOpAction {
  kind: "noop";
  keyPath: string;
  envName: string | undefined;
  providerName: string;
}

export interface AmbiguousAction {
  kind: "ambiguous";
  desired: { keyPath: string; providerName: string };
  candidates: Array<{ keyPath: string; providerName: string }>;
  hint: string;
}

export type Action = CreateAction | RenameAction | DeleteAction | NoOpAction | AmbiguousAction;

export type Plan = Action[];
