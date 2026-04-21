export interface DirectMapping {
  envVar: string;
  keyPath: string;
}

export interface TemplateMapping {
  envVar: string;
  template: string;
  keyPaths: string[];
}

export type AppMapping = DirectMapping | TemplateMapping;

const TEMPLATE_RE = /\$\{([^}]+)\}/g;

export function isTemplateMapping(m: AppMapping): m is TemplateMapping {
  return "template" in m;
}

export function resolveTemplate(
  template: string,
  resolvedMap: Map<string, string>
): { value: string; missing: string[] } {
  const missing: string[] = [];
  const value = template.replace(TEMPLATE_RE, (_, keyPath: string) => {
    const trimmed = keyPath.trim();
    const resolved = resolvedMap.get(trimmed);
    if (resolved === undefined) {
      missing.push(trimmed);
      return "";
    }
    return resolved;
  });
  return { value, missing };
}

export function parseAppMapping(content: string): AppMapping[] {
  const mappings: AppMapping[] = [];

  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;

    const envVar = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();

    if (!envVar || !value) continue;

    if (TEMPLATE_RE.test(value)) {
      TEMPLATE_RE.lastIndex = 0;
      const keyPaths = [...value.matchAll(TEMPLATE_RE)].map((m) => m[1].trim());
      mappings.push({ envVar, template: value, keyPaths });
    } else {
      mappings.push({ envVar, keyPath: value });
    }
  }

  return mappings;
}
