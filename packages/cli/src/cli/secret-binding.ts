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

// After a successful set/import, check whether storage still holds any
// `movedFrom` predecessor of the just-written record under the same
// provider binding. If so, return the first old path found — the caller
// hints the user to run `keyshelf up` to clean it up. validate() failures
// are swallowed: the hint is best-effort, never a hard error.
export async function findStaleRenameSource(
  registry: ProviderRegistry,
  loaded: LoadedConfig,
  record: NormalizedRecord & { kind: "secret" },
  providerRef: BuiltinProviderRef,
  envName: string | undefined
): Promise<string | undefined> {
  const movedFrom = record.movedFrom ?? [];
  if (movedFrom.length === 0) return undefined;

  const provider = registry.get(providerRef.name);
  const baseCtx = {
    envName,
    rootDir: loaded.rootDir,
    config: { ...(providerRef.options as unknown as Record<string, unknown>) },
    keyshelfName: loaded.config.name
  };

  for (const oldPath of movedFrom) {
    try {
      const exists = await provider.validate({ ...baseCtx, keyPath: oldPath });
      if (exists) return oldPath;
    } catch {
      // best-effort hint; ignore provider errors
    }
  }
  return undefined;
}
