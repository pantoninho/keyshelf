import { describe, it, expect, vi } from 'vitest';
import { applyEnvironmentPlan } from '../../../src/core/reconciler/apply.js';
import { SecretProvider } from '../../../src/providers/provider.js';
import { EnvironmentPlan } from '../../../src/core/reconciler/types.js';

function makeMockProvider(secrets: Record<string, string> = {}): SecretProvider {
    const store: Record<string, string> = { ...secrets };
    return {
        get: vi.fn(async (_env: string, path: string) => {
            const value = store[path];
            if (value === undefined) throw new Error(`Secret "${path}" not found`);
            return value;
        }),
        set: vi.fn(async (_env: string, path: string, value: string) => {
            store[path] = value;
        }),
        delete: vi.fn(async () => {}),
        list: vi.fn(async () => []),
        ref: vi.fn((_env: string, path: string) => path)
    };
}

describe('applyEnvironmentPlan', () => {
    it('does nothing for an empty plan', async () => {
        const provider = makeMockProvider();
        const plan: EnvironmentPlan = { envName: 'dev', secretChanges: [] };

        await applyEnvironmentPlan({
            plan,
            provider,
            collectValue: vi.fn(),
            getSourceProvider: vi.fn()
        });

        expect(provider.set).not.toHaveBeenCalled();
        expect(provider.delete).not.toHaveBeenCalled();
    });

    it('calls collectValue and sets secret for add change', async () => {
        const provider = makeMockProvider();
        const plan: EnvironmentPlan = {
            envName: 'dev',
            secretChanges: [{ kind: 'add', path: 'db/password' }]
        };
        const collectValue = vi.fn(async () => 'secret123');

        await applyEnvironmentPlan({
            plan,
            provider,
            collectValue,
            getSourceProvider: vi.fn()
        });

        expect(collectValue).toHaveBeenCalledWith('db/password');
        expect(provider.set).toHaveBeenCalledWith('dev', 'db/password', 'secret123');
    });

    it('copies secret from source provider for copy change', async () => {
        const targetProvider = makeMockProvider();
        const sourceProvider = makeMockProvider({ 'db/password': 'copied-secret' });
        const plan: EnvironmentPlan = {
            envName: 'dev',
            secretChanges: [{ kind: 'copy', path: 'db/password', sourceEnv: 'base' }]
        };
        const getSourceProvider = vi.fn(() => ({ provider: sourceProvider, env: 'base' }));

        await applyEnvironmentPlan({
            plan,
            provider: targetProvider,
            collectValue: vi.fn(),
            getSourceProvider
        });

        expect(sourceProvider.get).toHaveBeenCalledWith('base', 'db/password');
        expect(targetProvider.set).toHaveBeenCalledWith('dev', 'db/password', 'copied-secret');
    });

    it('deletes secret for remove change', async () => {
        const provider = makeMockProvider({ 'old/key': 'value' });
        const plan: EnvironmentPlan = {
            envName: 'dev',
            secretChanges: [{ kind: 'remove', path: 'old/key' }]
        };

        await applyEnvironmentPlan({
            plan,
            provider,
            collectValue: vi.fn(),
            getSourceProvider: vi.fn()
        });

        expect(provider.delete).toHaveBeenCalledWith('dev', 'old/key');
    });

    it('collects all values before writing any secrets', async () => {
        const provider = makeMockProvider();
        const plan: EnvironmentPlan = {
            envName: 'dev',
            secretChanges: [
                { kind: 'add', path: 'first/secret' },
                { kind: 'add', path: 'second/secret' }
            ]
        };

        const events: string[] = [];
        const collectValue = vi.fn(async (path: string) => {
            events.push(`collect:${path}`);
            return `value-for-${path}`;
        });
        (provider.set as ReturnType<typeof vi.fn>).mockImplementation(
            async (_env: string, path: string) => {
                events.push(`set:${path}`);
            }
        );

        await applyEnvironmentPlan({
            plan,
            provider,
            collectValue,
            getSourceProvider: vi.fn()
        });

        expect(events).toEqual([
            'collect:first/secret',
            'collect:second/secret',
            'set:first/secret',
            'set:second/secret'
        ]);
    });

    it('processes all changes in a mixed plan', async () => {
        const targetProvider = makeMockProvider({ 'old/key': 'value' });
        const sourceProvider = makeMockProvider({ 'shared/token': 'token-value' });
        const plan: EnvironmentPlan = {
            envName: 'dev',
            secretChanges: [
                { kind: 'add', path: 'new/secret' },
                { kind: 'copy', path: 'shared/token', sourceEnv: 'base' },
                { kind: 'remove', path: 'old/key' }
            ]
        };
        const collectValue = vi.fn(async () => 'new-value');
        const getSourceProvider = vi.fn(() => ({ provider: sourceProvider, env: 'base' }));

        await applyEnvironmentPlan({
            plan,
            provider: targetProvider,
            collectValue,
            getSourceProvider
        });

        expect(targetProvider.set).toHaveBeenCalledWith('dev', 'new/secret', 'new-value');
        expect(targetProvider.set).toHaveBeenCalledWith('dev', 'shared/token', 'token-value');
        expect(targetProvider.delete).toHaveBeenCalledWith('dev', 'old/key');
    });
});
