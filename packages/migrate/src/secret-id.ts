export function toSecretId(
  keyshelfName: string | undefined,
  envName: string,
  keyPath: string
): string {
  const path = keyPath.replace(/\//g, "__");
  const segments = ["keyshelf"];
  if (keyshelfName !== undefined) segments.push(keyshelfName);
  segments.push(envName, path);
  return segments.join("__");
}
