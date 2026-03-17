import yaml from 'js-yaml';
import {
    SecretRef,
    EnvironmentDefinition,
    ProviderConfig,
    TargetConfig,
    EasEnvironment
} from './types.js';
import { parseProviderConfig } from './config.js';

const KNOWN_TARGET_ADAPTERS = ['eas'];
const EAS_ENVIRONMENTS: EasEnvironment[] = ['development', 'preview', 'production'];

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

const SCHEMA = yaml.CORE_SCHEMA.extend([secretType]);

/** Parse a YAML environment file into an EnvironmentDefinition. */
export function parseEnvironment(content: string): EnvironmentDefinition {
    const doc = yaml.load(content, { schema: SCHEMA }) as Record<string, unknown>;
    const imports = (doc.imports as string[] | undefined) ?? [];
    const values = (doc.values as Record<string, unknown>) ?? {};

    let provider: ProviderConfig | undefined;
    if (doc.provider && typeof doc.provider === 'object' && !Array.isArray(doc.provider)) {
        provider = parseProviderConfig(doc.provider as Record<string, unknown>, 'environment file');
    }

    const targets = parseTargetsConfig(doc.targets);

    return { imports, provider, ...(targets && { targets }), values };
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
    if (def.targets) {
        doc.targets = def.targets;
    }
    doc.values = def.values;
    return yaml.dump(doc, { schema: SCHEMA });
}

/** Parse and validate a raw targets object into a Record of TargetConfig. */
function parseTargetsConfig(raw: unknown): Record<string, TargetConfig> | undefined {
    if (raw === undefined || raw === null) return undefined;

    if (typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Invalid environment file: "targets" must be a YAML mapping.');
    }

    const targets: Record<string, TargetConfig> = {};
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            throw new Error(`Invalid environment file: target "${name}" must be a YAML mapping.`);
        }
        targets[name] = parseTargetConfig(value as Record<string, unknown>, name);
    }

    return targets;
}

/** Parse and validate a single raw target entry into a TargetConfig. */
function parseTargetConfig(raw: Record<string, unknown>, name: string): TargetConfig {
    if (!raw.adapter || typeof raw.adapter !== 'string') {
        throw new Error(
            `Invalid environment file: target "${name}" is missing required field "adapter".`
        );
    }

    if (!KNOWN_TARGET_ADAPTERS.includes(raw.adapter)) {
        throw new Error(
            `Invalid environment file: target "${name}" has unknown adapter "${raw.adapter}". Available target adapters: ${KNOWN_TARGET_ADAPTERS.join(', ')}.`
        );
    }

    switch (raw.adapter) {
        case 'eas':
            return parseEasTargetConfig(raw, name);
        default:
            throw new Error('unreachable');
    }
}

function parseEasTargetConfig(raw: Record<string, unknown>, name: string): TargetConfig {
    if (!raw.environment || typeof raw.environment !== 'string') {
        throw new Error(
            `Invalid environment file: target "${name}" is missing required field "environment".`
        );
    }

    if (!EAS_ENVIRONMENTS.includes(raw.environment as EasEnvironment)) {
        throw new Error(
            `Invalid environment file: target "${name}" has invalid environment "${raw.environment}". Must be one of: ${EAS_ENVIRONMENTS.join(', ')}.`
        );
    }

    return { adapter: 'eas', environment: raw.environment as EasEnvironment };
}
