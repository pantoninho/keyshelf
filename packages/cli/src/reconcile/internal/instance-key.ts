export function instanceKey(providerName: string, providerParams: unknown): string {
  return `${providerName}:${stableStringify(providerParams)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return stableStringifyArray(value);
  return stableStringifyObject(value as Record<string, unknown>);
}

function stableStringifyArray(value: unknown[]): string {
  const parts: string[] = [];
  for (const item of value) parts.push(stableStringify(item));
  return `[${parts.join(",")}]`;
}

function stableStringifyObject(value: Record<string, unknown>): string {
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  const parts: string[] = [];
  for (const [k, v] of entries) parts.push(`${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${parts.join(",")}}`;
}
