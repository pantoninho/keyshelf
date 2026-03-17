import { describe, it, expect } from 'vitest';
import { buildPushPlan, renderPushPlan } from '../../src/core/push-plan.js';

describe('buildPushPlan', () => {
    it('adds keys present in desired but not current', () => {
        const plan = buildPushPlan(
            'eas-prod',
            { API_KEY: { value: 'secret', sensitive: true } },
            {}
        );

        expect(plan.changes).toEqual([{ kind: 'add', key: 'API_KEY', sensitive: true }]);
    });

    it('updates keys present in both with differing values', () => {
        const plan = buildPushPlan(
            'eas-prod',
            { API_KEY: { value: 'new-secret', sensitive: true } },
            { API_KEY: 'old-secret' }
        );

        expect(plan.changes).toEqual([{ kind: 'update', key: 'API_KEY', sensitive: true }]);
    });

    it('skips keys where desired and current values are equal', () => {
        const plan = buildPushPlan(
            'eas-prod',
            { API_KEY: { value: 'same-value', sensitive: false } },
            { API_KEY: 'same-value' }
        );

        expect(plan.changes).toHaveLength(0);
    });

    it('removes keys present in current but not desired', () => {
        const plan = buildPushPlan('eas-prod', {}, { STALE_KEY: 'old-value' });

        expect(plan.changes).toEqual([{ kind: 'remove', key: 'STALE_KEY' }]);
    });

    it('returns empty changes when desired and current match', () => {
        const plan = buildPushPlan(
            'eas-prod',
            { HOST: { value: 'localhost', sensitive: false } },
            { HOST: 'localhost' }
        );

        expect(plan.changes).toHaveLength(0);
    });

    it('captures targetName', () => {
        const plan = buildPushPlan('my-target', {}, {});
        expect(plan.targetName).toBe('my-target');
    });

    it('sorts changes: add before update before remove, then alphabetically within each kind', () => {
        const plan = buildPushPlan(
            'eas-prod',
            {
                Z_ADD: { value: 'v', sensitive: false },
                A_ADD: { value: 'v', sensitive: false },
                Z_UPDATE: { value: 'new', sensitive: false },
                A_UPDATE: { value: 'new', sensitive: false }
            },
            {
                Z_UPDATE: 'old',
                A_UPDATE: 'old',
                Z_REMOVE: 'v',
                A_REMOVE: 'v'
            }
        );

        const kinds = plan.changes.map((c) => c.kind);
        const keys = plan.changes.map((c) => c.key);

        // Kind ordering
        expect(kinds).toEqual(['add', 'add', 'update', 'update', 'remove', 'remove']);
        // Alphabetical within kind
        expect(keys.slice(0, 2)).toEqual(['A_ADD', 'Z_ADD']);
        expect(keys.slice(2, 4)).toEqual(['A_UPDATE', 'Z_UPDATE']);
        expect(keys.slice(4, 6)).toEqual(['A_REMOVE', 'Z_REMOVE']);
    });

    it('marks non-secret keys as sensitive=false for add and update', () => {
        const plan = buildPushPlan(
            'eas-prod',
            {
                PLAIN_NEW: { value: 'val', sensitive: false },
                PLAIN_UPDATED: { value: 'new', sensitive: false }
            },
            { PLAIN_UPDATED: 'old' }
        );

        for (const change of plan.changes) {
            if (change.kind !== 'remove') {
                expect(change.sensitive).toBe(false);
            }
        }
    });
});

describe('renderPushPlan', () => {
    it('returns "No changes." when there are no changes', () => {
        const plan = buildPushPlan('eas-prod', {}, {});
        expect(renderPushPlan(plan)).toBe('No changes.');
    });

    it('includes target name in header when there are changes', () => {
        const plan = buildPushPlan(
            'my-eas',
            { HOST: { value: 'localhost', sensitive: false } },
            {}
        );
        expect(renderPushPlan(plan)).toContain('Target: my-eas');
    });

    it('shows + for add, ~ for update, - for remove', () => {
        const plan = buildPushPlan(
            'eas-prod',
            {
                NEW_KEY: { value: 'v', sensitive: false },
                UPDATED_KEY: { value: 'new', sensitive: false }
            },
            { UPDATED_KEY: 'old', OLD_KEY: 'v' }
        );
        const output = renderPushPlan(plan);

        expect(output).toContain('+ NEW_KEY');
        expect(output).toContain('~ UPDATED_KEY');
        expect(output).toContain('- OLD_KEY');
    });

    it('never shows values in rendered output', () => {
        const plan = buildPushPlan(
            'eas-prod',
            { API_KEY: { value: 'super-secret-value', sensitive: true } },
            { API_KEY: 'old-secret-value' }
        );
        const output = renderPushPlan(plan);

        expect(output).not.toContain('super-secret-value');
        expect(output).not.toContain('old-secret-value');
    });

    it('shows (sensitive) tag for sensitive keys', () => {
        const plan = buildPushPlan(
            'eas-prod',
            { API_KEY: { value: 'secret', sensitive: true } },
            {}
        );
        const output = renderPushPlan(plan);

        expect(output).toContain('API_KEY');
        expect(output).toContain('(sensitive)');
    });

    it('does not show (sensitive) tag for non-sensitive keys', () => {
        const plan = buildPushPlan(
            'eas-prod',
            { HOST: { value: 'localhost', sensitive: false } },
            {}
        );
        const output = renderPushPlan(plan);

        expect(output).not.toContain('(sensitive)');
    });

    it('includes summary line with counts', () => {
        const plan = buildPushPlan(
            'eas-prod',
            {
                NEW_KEY: { value: 'v', sensitive: false },
                UPDATED_KEY: { value: 'new', sensitive: false }
            },
            { UPDATED_KEY: 'old', OLD_KEY: 'v' }
        );
        const output = renderPushPlan(plan);

        expect(output).toContain('1 addition(s)');
        expect(output).toContain('1 update(s)');
        expect(output).toContain('1 removal(s)');
    });
});
