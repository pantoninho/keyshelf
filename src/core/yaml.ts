import yaml from 'js-yaml';
import { SecretRef, EnvironmentDefinition } from './types.js';

const secretType = new yaml.Type('!secret', {
    kind: 'scalar',
    instanceOf: SecretRef,
    represent(ref: SecretRef) {
        return ref.path;
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
    return { imports, values };
}

/** Serialize an EnvironmentDefinition to YAML with !secret tags preserved. */
export function serializeEnvironment(def: EnvironmentDefinition): string {
    const doc: Record<string, unknown> = {};
    if (def.imports.length > 0) {
        doc.imports = def.imports;
    }
    doc.values = def.values;
    return yaml.dump(doc, { schema: SCHEMA });
}
