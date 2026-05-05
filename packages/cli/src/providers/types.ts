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

export interface Provider {
  name: string;
  resolve(ctx: ProviderContext): Promise<string>;
  validate(ctx: ProviderContext): Promise<boolean>;
  set(ctx: ProviderContext, value: string): Promise<void>;
  list(ctx: ProviderListContext): Promise<StoredKey[]>;
}
