export function flattenKeys(
  obj: Record<string, unknown>,
  prefix = '',
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}/${key}` : key;

    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      !('tag' in value && 'config' in value)
    ) {
      Object.assign(
        result,
        flattenKeys(value as Record<string, unknown>, path),
      );
    } else {
      result[path] = value;
    }
  }

  return result;
}

export function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split('/');
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (
      current[key] === undefined ||
      current[key] === null ||
      typeof current[key] !== 'object'
    ) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}
