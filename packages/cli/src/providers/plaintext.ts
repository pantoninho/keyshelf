import type { Provider, ProviderContext, StorageScope, StoredKey } from "./types.js";

export class PlaintextProvider implements Provider {
  name = "plaintext";
  // Plaintext values live inline in the config tree, not in storage. No
  // listing exists; scope is moot but envless matches the empty-list shape.
  storageScope: StorageScope = "envless";

  async resolve(ctx: ProviderContext): Promise<string> {
    const value = ctx.config.value;
    if (typeof value !== "string") {
      throw new Error(`Plaintext provider requires a string value for "${ctx.keyPath}"`);
    }
    return value;
  }

  async validate(ctx: ProviderContext): Promise<boolean> {
    return typeof ctx.config.value === "string";
  }

  async set(): Promise<void> {
    // No-op: plaintext values are stored directly in env files
  }

  async list(): Promise<StoredKey[]> {
    return [];
  }
}
