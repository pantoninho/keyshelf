import { describe, it, expect } from 'vitest';
import { buildEnvironmentPlan } from '../../../src/core/reconciler/diff.js';

describe('buildEnvironmentPlan', () => {
    it('returns empty plan when provider and resolved match', () => {
        const plan = buildEnvironmentPlan({
            envName: 'dev',
            resolvedSecretPaths: ['db/password'],
            providerSecretPaths: ['db/password'],
            importedSecretSources: new Map()
        });
        expect(plan.secretChanges).toEqual([]);
        expect(plan.envName).toBe('dev');
    });

    it('creates add change for secret in resolved but not in provider', () => {
        const plan = buildEnvironmentPlan({
            envName: 'dev',
            resolvedSecretPaths: ['db/password'],
            providerSecretPaths: [],
            importedSecretSources: new Map()
        });
        expect(plan.secretChanges).toEqual([{ kind: 'add', path: 'db/password' }]);
    });

    it('creates copy change for secret in resolved that comes from an import', () => {
        const sources = new Map([['db/password', 'base']]);
        const plan = buildEnvironmentPlan({
            envName: 'dev',
            resolvedSecretPaths: ['db/password'],
            providerSecretPaths: [],
            importedSecretSources: sources
        });
        expect(plan.secretChanges).toEqual([
            { kind: 'copy', path: 'db/password', sourceEnv: 'base' }
        ]);
    });

    it('creates remove change for secret in provider but not in resolved', () => {
        const plan = buildEnvironmentPlan({
            envName: 'dev',
            resolvedSecretPaths: [],
            providerSecretPaths: ['old/key'],
            importedSecretSources: new Map()
        });
        expect(plan.secretChanges).toEqual([{ kind: 'remove', path: 'old/key' }]);
    });

    it('handles mixed adds and removes together', () => {
        const plan = buildEnvironmentPlan({
            envName: 'dev',
            resolvedSecretPaths: ['new/key'],
            providerSecretPaths: ['old/key'],
            importedSecretSources: new Map()
        });
        expect(plan.secretChanges).toContainEqual({ kind: 'add', path: 'new/key' });
        expect(plan.secretChanges).toContainEqual({ kind: 'remove', path: 'old/key' });
    });

    it('handles multiple changes of each kind', () => {
        const sources = new Map([['imported/secret', 'base']]);
        const plan = buildEnvironmentPlan({
            envName: 'dev',
            resolvedSecretPaths: ['new/key', 'imported/secret'],
            providerSecretPaths: ['old/key1', 'old/key2'],
            importedSecretSources: sources
        });
        expect(plan.secretChanges).toContainEqual({ kind: 'add', path: 'new/key' });
        expect(plan.secretChanges).toContainEqual({
            kind: 'copy',
            path: 'imported/secret',
            sourceEnv: 'base'
        });
        expect(plan.secretChanges).toContainEqual({ kind: 'remove', path: 'old/key1' });
        expect(plan.secretChanges).toContainEqual({ kind: 'remove', path: 'old/key2' });
    });
});
