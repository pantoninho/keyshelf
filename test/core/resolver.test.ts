import { describe, it, expect } from 'vitest';
import { resolve } from '../../src/core/resolver.js';
import { SecretRef, EnvironmentDefinition } from '../../src/core/types.js';

type LoadFn = (name: string) => Promise<EnvironmentDefinition>;

function makeLoadFn(envs: Record<string, EnvironmentDefinition>): LoadFn {
    return async (name: string) => {
        const env = envs[name];
        if (!env) throw new Error(`Environment "${name}" not found`);
        return env;
    };
}

describe('resolver', () => {
    it('resolve environment with no imports returns values as-is', async () => {
        const load = makeLoadFn({
            dev: { imports: [], values: { key: 'val' } }
        });

        const result = await resolve('dev', load);

        expect(result.values).toEqual({ key: 'val' });
        expect(result.secretRefs).toEqual([]);
    });

    it('resolve environment with single import merges values', async () => {
        const load = makeLoadFn({
            base: { imports: [], values: { database: { port: 5432 } } },
            dev: { imports: ['base'], values: { database: { host: 'localhost' } } }
        });

        const result = await resolve('dev', load);

        expect(result.values).toEqual({
            database: { host: 'localhost', port: 5432 }
        });
    });

    it('current environment values override imported values', async () => {
        const load = makeLoadFn({
            base: { imports: [], values: { database: { host: 'prod-db', port: 5432 } } },
            dev: { imports: ['base'], values: { database: { host: 'localhost' } } }
        });

        const result = await resolve('dev', load);

        expect(result.values).toEqual({
            database: { host: 'localhost', port: 5432 }
        });
    });

    it('import order: later imports override earlier ones', async () => {
        const load = makeLoadFn({
            a: { imports: [], values: { key: 'from-a', only_a: true } },
            b: { imports: [], values: { key: 'from-b', only_b: true } },
            dev: { imports: ['a', 'b'], values: {} }
        });

        const result = await resolve('dev', load);

        expect(result.values).toEqual({ key: 'from-b', only_a: true, only_b: true });
    });

    it('chained imports (3 levels)', async () => {
        const load = makeLoadFn({
            base: { imports: [], values: { a: 1, b: 1, c: 1 } },
            staging: { imports: ['base'], values: { b: 2, c: 2 } },
            prod: { imports: ['staging'], values: { c: 3 } }
        });

        const result = await resolve('prod', load);

        expect(result.values).toEqual({ a: 1, b: 2, c: 3 });
    });

    it('circular import throws descriptive error', async () => {
        const load = makeLoadFn({
            a: { imports: ['b'], values: {} },
            b: { imports: ['a'], values: {} }
        });

        await expect(resolve('a', load)).rejects.toThrow(/circular/i);
    });

    it('self-import throws error', async () => {
        const load = makeLoadFn({
            a: { imports: ['a'], values: {} }
        });

        await expect(resolve('a', load)).rejects.toThrow(/circular/i);
    });

    it('SecretRef values survive merge', async () => {
        const load = makeLoadFn({
            base: { imports: [], values: { db: { password: new SecretRef('db/pass') } } },
            dev: { imports: ['base'], values: { db: { host: 'localhost' } } }
        });

        const result = await resolve('dev', load);

        const db = result.values.db as Record<string, unknown>;
        expect(db.host).toBe('localhost');
        expect(db.password).toBeInstanceOf(SecretRef);
        expect((db.password as SecretRef).path).toBe('db/pass');
    });

    it('resolver collects all SecretRef paths from resolved tree', async () => {
        const load = makeLoadFn({
            base: {
                imports: [],
                values: {
                    db: { password: new SecretRef('db/password') },
                    api: { key: new SecretRef('api/key') }
                }
            },
            dev: {
                imports: ['base'],
                values: { smtp: { password: new SecretRef('smtp/password') } }
            }
        });

        const result = await resolve('dev', load);

        expect(result.secretRefs.sort()).toEqual(['api/key', 'db/password', 'smtp/password']);
    });
});
