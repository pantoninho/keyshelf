import { describe, it, expect } from 'vitest';
import { PathTree } from '../../src/core/path-tree.js';

describe('PathTree', () => {
    describe('get and set', () => {
        it('sets and gets a value at a simple path', () => {
            const tree = new PathTree();
            tree.set('database/host', 'localhost');
            expect(tree.get('database/host')).toBe('localhost');
        });

        it('sets and gets nested paths', () => {
            const tree = new PathTree();
            tree.set('api/stripe/key', 'sk_123');
            expect(tree.get('api/stripe/key')).toBe('sk_123');
        });

        it('gets a subtree', () => {
            const tree = new PathTree();
            tree.set('database/host', 'localhost');
            tree.set('database/port', 5432);
            expect(tree.get('database')).toEqual({ host: 'localhost', port: 5432 });
        });

        it('returns undefined for missing paths', () => {
            const tree = new PathTree();
            expect(tree.get('missing/path')).toBeUndefined();
        });
    });

    describe('delete', () => {
        it('deletes a value', () => {
            const tree = new PathTree();
            tree.set('database/host', 'localhost');
            tree.delete('database/host');
            expect(tree.get('database/host')).toBeUndefined();
        });

        it('cleans up empty parent nodes', () => {
            const tree = new PathTree();
            tree.set('a/b/c', 'value');
            tree.delete('a/b/c');
            expect(tree.get('a')).toBeUndefined();
        });
    });

    describe('list', () => {
        it('lists paths under a prefix', () => {
            const tree = new PathTree();
            tree.set('database/host', 'localhost');
            tree.set('database/port', 5432);
            tree.set('api/key', 'abc');
            expect(tree.list('database').sort()).toEqual(['database/host', 'database/port']);
        });

        it('lists all paths', () => {
            const tree = new PathTree();
            tree.set('database/host', 'localhost');
            tree.set('database/port', 5432);
            tree.set('api/key', 'abc');
            expect(tree.list().sort()).toEqual(['api/key', 'database/host', 'database/port']);
        });
    });

    describe('serialization', () => {
        it('toJSON returns the internal nested object', () => {
            const tree = new PathTree();
            tree.set('database/host', 'localhost');
            tree.set('database/port', 5432);
            expect(tree.toJSON()).toEqual({ database: { host: 'localhost', port: 5432 } });
        });

        it('fromJSON constructs a PathTree from a nested object', () => {
            const tree = PathTree.fromJSON({ database: { host: 'localhost', port: 5432 } });
            expect(tree.get('database/host')).toBe('localhost');
            expect(tree.get('database/port')).toBe(5432);
        });
    });

    describe('merge', () => {
        it('merges two trees: objects merge recursively', () => {
            const a = PathTree.fromJSON({ database: { host: 'a', port: 5432 } });
            const b = PathTree.fromJSON({ database: { host: 'b' } });
            const result = a.merge(b);
            expect(result.toJSON()).toEqual({ database: { host: 'b', port: 5432 } });
        });

        it('scalar replaces object', () => {
            const a = PathTree.fromJSON({ database: { host: 'a', port: 5432 } });
            const b = PathTree.fromJSON({ database: 'just-a-string' });
            const result = a.merge(b);
            expect(result.get('database')).toBe('just-a-string');
        });

        it('object replaces scalar', () => {
            const a = PathTree.fromJSON({ database: 'just-a-string' });
            const b = PathTree.fromJSON({ database: { host: 'b', port: 5432 } });
            const result = a.merge(b);
            expect(result.toJSON()).toEqual({ database: { host: 'b', port: 5432 } });
        });

        it('null removes key', () => {
            const a = PathTree.fromJSON({ database: { host: 'a', port: 5432 } });
            const b = PathTree.fromJSON({ database: { host: null } });
            const result = a.merge(b);
            expect(result.toJSON()).toEqual({ database: { port: 5432 } });
        });

        it('second tree wins on conflict', () => {
            const a = PathTree.fromJSON({ key: 'from-a' });
            const b = PathTree.fromJSON({ key: 'from-b' });
            const result = a.merge(b);
            expect(result.get('key')).toBe('from-b');
        });

        it('does not mutate either input tree', () => {
            const a = PathTree.fromJSON({ database: { host: 'a', port: 5432 } });
            const b = PathTree.fromJSON({ database: { host: 'b' } });
            const aJson = JSON.stringify(a.toJSON());
            const bJson = JSON.stringify(b.toJSON());
            a.merge(b);
            expect(JSON.stringify(a.toJSON())).toBe(aJson);
            expect(JSON.stringify(b.toJSON())).toBe(bJson);
        });
    });
});
