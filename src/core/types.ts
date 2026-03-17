/** A reference to a secret stored in an external provider. */
export class SecretRef {
    constructor(public readonly path: string) {}
}

/** An environment definition as stored in YAML. */
export interface EnvironmentDefinition {
    imports: string[];
    provider?: ProviderConfig;
    values: Record<string, unknown>;
}

/** Discriminated union for adapter-specific provider configuration. */
export type ProviderConfig =
    | { adapter: 'local' }
    | { adapter: 'gcp-sm'; project: string }
    | { adapter: 'aws-sm' };

/** Project-level configuration from keyshelf.yml. */
export interface KeyshelfConfig {
    name: string;
    provider: ProviderConfig;
}
