/**
 * Topologically sort environments by import dependency using Kahn's algorithm.
 * Parents are guaranteed to appear before children in the result.
 *
 * @param envs - Map of environment name to its direct imports
 * @returns Sorted array of environment names, parents first
 * @throws When a cycle is detected in the import graph
 */
export function topoSort(envs: Record<string, { imports: string[] }>): string[] {
    const inDegree = buildInDegreeMap(envs);
    const queue = Object.keys(inDegree).filter((name) => inDegree[name] === 0);
    const result: string[] = [];

    while (queue.length > 0) {
        const node = queue.shift()!;
        result.push(node);
        for (const dependent of findDependents(envs, node)) {
            inDegree[dependent]--;
            if (inDegree[dependent] === 0) {
                queue.push(dependent);
            }
        }
    }

    if (result.length !== Object.keys(envs).length) {
        throw new Error(
            'Cycle detected in environment imports. Check your import chain for circular dependencies.'
        );
    }

    return result;
}

function buildInDegreeMap(envs: Record<string, { imports: string[] }>): Record<string, number> {
    const inDegree: Record<string, number> = {};
    for (const name of Object.keys(envs)) {
        inDegree[name] ??= 0;
        for (const imp of envs[name].imports) {
            inDegree[imp] ??= 0;
        }
    }
    // Each env has in-degree equal to the number of envs that import it as a dep.
    // We increment the env's own in-degree for each of its imports (the env can't
    // be processed until all its imports are processed first).
    for (const [name, { imports }] of Object.entries(envs)) {
        inDegree[name] += imports.length;
    }
    return inDegree;
}

function findDependents(envs: Record<string, { imports: string[] }>, parent: string): string[] {
    return Object.entries(envs)
        .filter(([, def]) => def.imports.includes(parent))
        .map(([name]) => name);
}
