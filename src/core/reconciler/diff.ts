import { EnvironmentPlan, SecretChange } from './types.js';

interface DiffInput {
    envName: string;
    resolvedSecretPaths: string[];
    providerSecretPaths: string[];
    importedSecretSources: Map<string, string>;
}

/**
 * Build a plan of secret changes for a single environment.
 *
 * Additions: secrets in resolved but not in provider.
 *   If present in importedSecretSources → 'copy', else → 'add'.
 * Deletions: secrets in provider but not in resolved → 'remove'.
 *
 * @param input - Resolved paths, provider paths, and import sources for this env
 * @returns The environment plan with all secret changes
 */
export function buildEnvironmentPlan(input: DiffInput): EnvironmentPlan {
    const { envName, resolvedSecretPaths, providerSecretPaths, importedSecretSources } = input;
    const providerSet = new Set(providerSecretPaths);
    const resolvedSet = new Set(resolvedSecretPaths);
    const secretChanges: SecretChange[] = [];

    for (const path of resolvedSecretPaths) {
        if (!providerSet.has(path)) {
            secretChanges.push(buildAddChange(path, importedSecretSources));
        }
    }

    for (const path of providerSecretPaths) {
        if (!resolvedSet.has(path)) {
            secretChanges.push({ kind: 'remove', path });
        }
    }

    return { envName, secretChanges };
}

function buildAddChange(path: string, importedSecretSources: Map<string, string>): SecretChange {
    const sourceEnv = importedSecretSources.get(path);
    if (sourceEnv !== undefined) {
        return { kind: 'copy', path, sourceEnv };
    }
    return { kind: 'add', path };
}
