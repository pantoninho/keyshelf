import yaml from 'js-yaml';
import { SecretRef, EnvironmentDefinition, ProviderConfig } from './types.js';
import { parseProviderConfig } from './config.js';

const secretType = new yaml.Type('!secret', {
    kind: 'scalar',
    instanceOf: SecretRef,
    represent(ref: object) {
        return (ref as SecretRef).path;
    },
    construct(data: string) {
        return new SecretRef(data);
    }
});

const SCHEMA = yaml.DEFAULT_SCHEMA.extend([secretType]);

/** Parse a YAML environment file into an EnvironmentDefinition. */
export function parseEnvironment(content: string): EnvironmentDefinition {
    const doc = yaml.load(content, { schema: SCHEMA }) as Record<string, unknown>;
    const imports = (doc.imports as string[] | undefined) ?? [];
    const values = (doc.values as Record<string, unknown>) ?? {};

    let provider: ProviderConfig | undefined;
    if (doc.provider && typeof doc.provider === 'object' && !Array.isArray(doc.provider)) {
        provider = parseProviderConfig(doc.provider as Record<string, unknown>, 'environment file');
    }

    return { imports, provider, values };
}

/** Serialize an EnvironmentDefinition to YAML with !secret tags preserved. */
export function serializeEnvironment(def: EnvironmentDefinition): string {
    const doc: Record<string, unknown> = {};
    if (def.imports.length > 0) {
        doc.imports = def.imports;
    }
    if (def.provider) {
        doc.provider = def.provider;
    }
    doc.values = def.values;
    return yaml.dump(doc, { schema: SCHEMA });
}
