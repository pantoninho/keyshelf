import { SecretRef } from './types.js';

type TreeNode = Record<string, unknown>;

function deepClone(obj: unknown): unknown {
    if (obj instanceof SecretRef) return new SecretRef(obj.path);
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(deepClone);
    const result: TreeNode = {};
    for (const [key, value] of Object.entries(obj)) {
        result[key] = deepClone(value);
    }
    return result;
}

/** A tree structure addressed by slash-delimited paths. */
export class PathTree {
    private data: TreeNode;

    constructor(data: TreeNode = {}) {
        this.data = data;
    }

    /** Get a value or subtree at the given path. */
    get(path: string): unknown {
        const segments = path.split('/');
        let current: unknown = this.data;

        for (const segment of segments) {
            if (current === null || typeof current !== 'object') return undefined;
            current = (current as TreeNode)[segment];
        }

        return current;
    }

    /** Set a value at the given path, creating intermediate nodes as needed. */
    set(path: string, value: unknown): void {
        const segments = path.split('/');
        let current = this.data;

        for (let i = 0; i < segments.length - 1; i++) {
            const segment = segments[i];
            const next = current[segment];
            if (next === null || typeof next !== 'object') {
                current[segment] = {};
            }
            current = current[segment] as TreeNode;
        }

        current[segments[segments.length - 1]] = value;
    }

    /** Delete a value at the given path, cleaning up empty parents. */
    delete(path: string): void {
        const segments = path.split('/');
        this.deleteRecursive(this.data, segments, 0);
    }

    /** List all leaf paths, optionally under a prefix. */
    list(prefix?: string): string[] {
        const paths: string[] = [];
        const startNode = prefix ? this.get(prefix) : this.data;

        if (startNode === null || typeof startNode !== 'object') return paths;

        this.collectPaths(startNode as TreeNode, prefix ?? '', paths);
        return paths;
    }

    /** Return the internal nested object. */
    toJSON(): TreeNode {
        return deepClone(this.data) as TreeNode;
    }

    /** Merge another PathTree into this one using JSON Merge Patch semantics. Returns a new tree. */
    merge(other: PathTree): PathTree {
        const merged = jsonMergePatch(deepClone(this.data), other.data);
        return new PathTree(merged as TreeNode);
    }

    /** Construct a PathTree from a nested object. */
    static fromJSON(obj: Record<string, unknown>): PathTree {
        return new PathTree(deepClone(obj) as TreeNode);
    }

    private deleteRecursive(node: TreeNode, segments: string[], index: number): boolean {
        const segment = segments[index];

        if (index === segments.length - 1) {
            delete node[segment];
            return Object.keys(node).length === 0;
        }

        const child = node[segment];
        if (child === null || typeof child !== 'object') return false;

        const childEmpty = this.deleteRecursive(child as TreeNode, segments, index + 1);
        if (childEmpty) {
            delete node[segment];
            return Object.keys(node).length === 0;
        }

        return false;
    }

    private collectPaths(node: TreeNode, prefix: string, paths: string[]): void {
        for (const [key, value] of Object.entries(node)) {
            const fullPath = prefix ? `${prefix}/${key}` : key;
            if (isTreeNode(value)) {
                this.collectPaths(value as TreeNode, fullPath, paths);
            } else {
                paths.push(fullPath);
            }
        }
    }
}

function isTreeNode(value: unknown): value is TreeNode {
    return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof SecretRef);
}

/** RFC 7396 JSON Merge Patch. */
function jsonMergePatch(target: unknown, patch: unknown): unknown {
    if (!isTreeNode(patch)) {
        return patch;
    }

    if (!isTreeNode(target)) {
        target = {};
    }

    const result = { ...(target as TreeNode) };
    for (const [key, value] of Object.entries(patch as TreeNode)) {
        if (value === null) {
            delete result[key];
        } else {
            result[key] = jsonMergePatch(result[key], value);
        }
    }
    return result;
}
