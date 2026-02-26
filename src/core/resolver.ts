import { EnvironmentDefinition, SecretRef } from './types.js';
import { PathTree } from './path-tree.js';

type LoadFn = (name: string) => Promise<EnvironmentDefinition>;

interface ResolveResult {
    values: Record<string, unknown>;
    secretRefs: string[];
}

/** Resolve an environment by recursively merging its imports. */
export async function resolve(envName: string, loadFn: LoadFn): Promise<ResolveResult> {
    const visited = new Set<string>();
    const tree = await resolveRecursive(envName, loadFn, visited);
    const values = tree.toJSON();
    const secretRefs = collectSecretRefs(values);
    return { values, secretRefs };
}

async function resolveRecursive(
    envName: string,
    loadFn: LoadFn,
    visited: Set<string>
): Promise<PathTree> {
    if (visited.has(envName)) {
        throw new Error(`Circular import detected: "${envName}" was already visited`);
    }
    visited.add(envName);

    const def = await loadFn(envName);

    let merged = PathTree.fromJSON({});
    for (const importName of def.imports) {
        const importedTree = await resolveRecursive(importName, loadFn, new Set(visited));
        merged = merged.merge(importedTree);
    }

    const current = PathTree.fromJSON(def.values);
    return merged.merge(current);
}

function collectSecretRefs(obj: Record<string, unknown>, prefix = ''): string[] {
    const refs: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
        if (value instanceof SecretRef) {
            refs.push(value.path);
        } else if (value !== null && typeof value === 'object') {
            refs.push(...collectSecretRefs(value as Record<string, unknown>, prefix + key + '/'));
        }
    }
    return refs;
}
