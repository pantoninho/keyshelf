import { ProviderRegistry } from "./registry.js";
import { PlaintextProvider } from "./plaintext.js";
import { AgeProvider } from "./age.js";
import { GcpSmProvider } from "./gcp-sm.js";
import { SopsProvider } from "./sops.js";

export function createDefaultRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(new PlaintextProvider());
  registry.register(new AgeProvider());
  registry.register(new GcpSmProvider());
  registry.register(new SopsProvider());
  return registry;
}
