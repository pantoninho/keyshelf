import type { Provider, ProviderContext } from "./types.js";

export class PlaintextProvider implements Provider {
  name = "plaintext";

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

  async delete(): Promise<void> {
    // No-op: plaintext values are stored directly in env files
  }
}
