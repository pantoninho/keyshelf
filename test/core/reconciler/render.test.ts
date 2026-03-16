import { describe, it, expect } from 'vitest';
import { renderPlan } from '../../../src/core/reconciler/render.js';
import { ReconciliationPlan } from '../../../src/core/reconciler/types.js';

function stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('renderPlan', () => {
    it('renders environment header', () => {
        const plan: ReconciliationPlan = {
            environments: [{ envName: 'dev', secretChanges: [] }]
        };
        const output = stripAnsi(renderPlan(plan));
        expect(output).toContain('Environment: dev');
    });

    it('shows no changes message when plan is empty', () => {
        const plan: ReconciliationPlan = {
            environments: [{ envName: 'dev', secretChanges: [] }]
        };
        const output = stripAnsi(renderPlan(plan));
        expect(output).toContain('(no changes)');
    });

    it('renders add change with + prefix and (new) label', () => {
        const plan: ReconciliationPlan = {
            environments: [
                {
                    envName: 'dev',
                    secretChanges: [{ kind: 'add', path: 'db/password' }]
                }
            ]
        };
        const output = stripAnsi(renderPlan(plan));
        expect(output).toContain('+ secret  db/password  (new)');
    });

    it('renders remove change with - prefix', () => {
        const plan: ReconciliationPlan = {
            environments: [
                {
                    envName: 'dev',
                    secretChanges: [{ kind: 'remove', path: 'old/key' }]
                }
            ]
        };
        const output = stripAnsi(renderPlan(plan));
        expect(output).toContain('- secret  old/key');
    });

    it('renders copy change with source environment', () => {
        const plan: ReconciliationPlan = {
            environments: [
                {
                    envName: 'dev',
                    secretChanges: [{ kind: 'copy', path: 'shared/token', sourceEnv: 'base' }]
                }
            ]
        };
        const output = stripAnsi(renderPlan(plan));
        expect(output).toContain('shared/token');
        expect(output).toContain('from base');
    });

    it('renders multiple environments', () => {
        const plan: ReconciliationPlan = {
            environments: [
                { envName: 'base', secretChanges: [] },
                {
                    envName: 'dev',
                    secretChanges: [{ kind: 'add', path: 'db/password' }]
                }
            ]
        };
        const output = stripAnsi(renderPlan(plan));
        expect(output).toContain('Environment: base');
        expect(output).toContain('Environment: dev');
    });

    it('uses green ANSI code for add changes', () => {
        const plan: ReconciliationPlan = {
            environments: [
                {
                    envName: 'dev',
                    secretChanges: [{ kind: 'add', path: 'db/password' }]
                }
            ]
        };
        const output = renderPlan(plan);
        expect(output).toContain('\x1b[32m');
    });

    it('uses red ANSI code for remove changes', () => {
        const plan: ReconciliationPlan = {
            environments: [
                {
                    envName: 'dev',
                    secretChanges: [{ kind: 'remove', path: 'old/key' }]
                }
            ]
        };
        const output = renderPlan(plan);
        expect(output).toContain('\x1b[31m');
    });

    it('uses cyan ANSI code for copy changes', () => {
        const plan: ReconciliationPlan = {
            environments: [
                {
                    envName: 'dev',
                    secretChanges: [{ kind: 'copy', path: 'shared/token', sourceEnv: 'base' }]
                }
            ]
        };
        const output = renderPlan(plan);
        expect(output).toContain('\x1b[36m');
    });
});
