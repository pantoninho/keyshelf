export type EnvKey = string;
export type EnvSet = Set<EnvKey>;

const ENVLESS: EnvKey = "\0envless";

export function newEnvSet(): EnvSet {
  return new Set<EnvKey>();
}

export function envKey(envName: string | undefined): EnvKey {
  return envName ?? ENVLESS;
}

export function envKeyValue(key: EnvKey): string | undefined {
  return key === ENVLESS ? undefined : key;
}

export function envSetsEqual(a: EnvSet, b: EnvSet): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

export function envSorter(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  return a.localeCompare(b);
}

export { ENVLESS };
