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
  envBindings: Array<string | undefined>;
}

export interface DeleteAction {
  kind: "delete";
  keyPath: string;
  envName: string | undefined;
  providerName: string;
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
