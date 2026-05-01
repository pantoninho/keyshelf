export interface ProviderContext {
  keyPath: string;
  envName: string | undefined;
  rootDir: string;
  config: Record<string, unknown>;
  keyshelfName?: string;
}

export interface Provider {
  name: string;
  resolve(ctx: ProviderContext): Promise<string>;
  validate(ctx: ProviderContext): Promise<boolean>;
  set(ctx: ProviderContext, value: string): Promise<void>;
}
