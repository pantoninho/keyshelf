import type { ProviderRegistry } from "../providers/registry.js";
import type { BuiltinProviderRef, NormalizedRecord } from "../config/types.js";
import type { LoadedConfig } from "../config/loader.js";

export function pickProviderRef(
  record: NormalizedRecord & { kind: "secret" },
  envName: string | undefined
): BuiltinProviderRef | undefined {
  if (
    envName !== undefined &&
    record.values !== undefined &&
    Object.hasOwn(record.values, envName)
  ) {
    return record.values[envName];
  }
  return record.value;
}

export async function writeSecret(
  registry: ProviderRegistry,
  loaded: LoadedConfig,
  providerRef: BuiltinProviderRef,
  keyPath: string,
  envName: string | undefined,
  value: string
): Promise<void> {
  const provider = registry.get(providerRef.name);
  await provider.set(
    {
      keyPath,
      envName,
      rootDir: loaded.rootDir,
      config: { ...(providerRef.options as unknown as Record<string, unknown>) },
      keyshelfName: loaded.config.name
    },
    value
  );
}
