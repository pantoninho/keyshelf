/** A reference to a secret stored in an external provider. */
export class SecretRef {
    constructor(public readonly path: string) {}
}

/** An environment definition as stored in YAML. */
export interface EnvironmentDefinition {
    imports: string[];
    values: Record<string, unknown>;
}

/** Project-level configuration from keyshelf.yml. */
export interface KeyshelfConfig {
    name: string;
    provider: {
        adapter: string;
    };
}
