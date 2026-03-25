export interface AppMapping {
  envVar: string;
  keyPath: string;
}

export function parseAppMapping(content: string): AppMapping[] {
  const mappings: AppMapping[] = [];

  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;

    const envVar = line.slice(0, eqIndex).trim();
    const keyPath = line.slice(eqIndex + 1).trim();

    if (envVar && keyPath) {
      mappings.push({ envVar, keyPath });
    }
  }

  return mappings;
}
