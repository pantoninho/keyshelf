import type { BuiltinProviderRef, NormalizedConfig, NormalizedRecord } from "../../config/types.js";

export interface DesiredBinding {
  keyPath: string;
  envName: string | undefined;
  providerName: string;
  providerParams: unknown;
}

export function collectDesiredBindings(config: NormalizedConfig): DesiredBinding[] {
  const collector = new BindingsCollector(config.envs);
  for (const record of config.keys) {
    collector.absorb(record);
  }
  return collector.bindings;
}

export function collectProviderRefs(record: NormalizedRecord): BuiltinProviderRef[] {
  if (record.kind !== "secret") return [];
  const refs: BuiltinProviderRef[] = [];
  if (record.value !== undefined) refs.push(record.value);
  for (const ref of Object.values(record.values ?? {})) refs.push(ref);
  return refs;
}

class BindingsCollector {
  readonly bindings: DesiredBinding[] = [];

  constructor(readonly envs: readonly string[]) {}

  absorb(record: NormalizedRecord): void {
    if (record.kind !== "secret") return;
    const envless = record.value;
    const perEnv = record.values ?? {};

    if (envless !== undefined) {
      this.absorbEnvless(record.path, envless, perEnv);
    }
    this.absorbPerEnv(record.path, perEnv);
  }

  // value/default applies as a fallback for every env not overridden in
  // values. For envless storage providers this collapses to a single entry;
  // the planner handles the collapse via storageScope.
  private absorbEnvless(
    keyPath: string,
    envless: BuiltinProviderRef,
    perEnv: Record<string, BuiltinProviderRef>
  ): void {
    const overridden = new Map<string, true>();
    for (const env of Object.keys(perEnv)) overridden.set(env, true);
    for (const env of this.envs) {
      if (overridden.has(env)) continue;
      this.bindings.push({
        keyPath,
        envName: env,
        providerName: envless.name,
        providerParams: envless.options
      });
    }
  }

  private absorbPerEnv(keyPath: string, perEnv: Record<string, BuiltinProviderRef>): void {
    for (const [envName, ref] of Object.entries(perEnv)) {
      this.bindings.push({
        keyPath,
        envName,
        providerName: ref.name,
        providerParams: ref.options
      });
    }
  }
}
