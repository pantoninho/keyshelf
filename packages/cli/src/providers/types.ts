export interface ProviderContext {
  keyPath: string;
  envName: string | undefined;
  rootDir: string;
  config: Record<string, unknown>;
  keyshelfName?: string;
}

export interface ProviderListContext {
  rootDir: string;
  config: Record<string, unknown>;
  keyshelfName?: string;
  // Known env names from the keyshelf config. Providers that encode env
  // in their storage id (e.g. gcp) use this to disambiguate which segment
  // is the env vs part of the key path. Envless providers ignore it.
  envs?: string[];
}

export interface StoredKey {
  keyPath: string;
  envName: string | undefined;
}

// Whether this provider's storage layout encodes env in the storage id.
// gcp uses `envless__<env>__<path>`, so different envs map to different
// stored entries (perEnv). age and sops store one entry per key path
// regardless of env (envless). The planner uses this to decide whether
// a value/default binding fans out into per-env entries when matching
// desired vs actual.
export type StorageScope = "envless" | "perEnv";

export interface Provider {
  name: string;
  storageScope: StorageScope;
  resolve(ctx: ProviderContext): Promise<string>;
  validate(ctx: ProviderContext): Promise<boolean>;
  set(ctx: ProviderContext, value: string): Promise<void>;
  list(ctx: ProviderListContext): Promise<StoredKey[]>;
}
