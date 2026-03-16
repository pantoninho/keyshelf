import { describe, it, expect } from 'vitest';
import { topoSort } from '../../../src/core/reconciler/topo-sort.js';

describe('topoSort', () => {
    it('returns single env with no imports', () => {
        const result = topoSort({ dev: { imports: [] } });
        expect(result).toEqual(['dev']);
    });

    it('returns parent before child', () => {
        const envs = {
            dev: { imports: ['base'] },
            base: { imports: [] }
        };
        const result = topoSort(envs);
        expect(result.indexOf('base')).toBeLessThan(result.indexOf('dev'));
    });

    it('returns all envs in a chain in order', () => {
        const envs = {
            prod: { imports: ['staging'] },
            staging: { imports: ['base'] },
            base: { imports: [] }
        };
        const result = topoSort(envs);
        expect(result.indexOf('base')).toBeLessThan(result.indexOf('staging'));
        expect(result.indexOf('staging')).toBeLessThan(result.indexOf('prod'));
    });

    it('handles multiple independent envs without imports', () => {
        const envs = {
            dev: { imports: [] },
            staging: { imports: [] },
            prod: { imports: [] }
        };
        const result = topoSort(envs);
        expect(result).toHaveLength(3);
        expect(result).toContain('dev');
        expect(result).toContain('staging');
        expect(result).toContain('prod');
    });

    it('handles diamond dependency correctly', () => {
        const envs = {
            prod: { imports: ['base', 'shared'] },
            staging: { imports: ['base', 'shared'] },
            base: { imports: [] },
            shared: { imports: [] }
        };
        const result = topoSort(envs);
        expect(result.indexOf('base')).toBeLessThan(result.indexOf('prod'));
        expect(result.indexOf('base')).toBeLessThan(result.indexOf('staging'));
        expect(result.indexOf('shared')).toBeLessThan(result.indexOf('prod'));
        expect(result.indexOf('shared')).toBeLessThan(result.indexOf('staging'));
    });

    it('throws on direct cycle', () => {
        const envs = {
            a: { imports: ['b'] },
            b: { imports: ['a'] }
        };
        expect(() => topoSort(envs)).toThrow(/[Cc]ycle/);
    });

    it('throws on indirect cycle', () => {
        const envs = {
            a: { imports: ['b'] },
            b: { imports: ['c'] },
            c: { imports: ['a'] }
        };
        expect(() => topoSort(envs)).toThrow(/[Cc]ycle/);
    });

    it('throws when an env imports a name not present in the map', () => {
        const envs = {
            dev: { imports: ['missing'] }
        };
        expect(() => topoSort(envs)).toThrow('Environment "missing" not found (imported by "dev")');
    });
});
