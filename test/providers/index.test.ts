import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createProvider, resolveProvider } from '../../src/providers/index.js';
import { LocalProvider } from '../../src/providers/local.js';
import { GcpSmProvider } from '../../src/providers/gcp-sm.js';
import { AwsSmProvider } from '../../src/providers/aws-sm.js';

describe('createProvider', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-factory-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('creates a working local provider', async () => {
        const provider = createProvider({ adapter: 'local' }, tmpDir, 'myapp');

        await provider.set('dev', 'db/pass', 'secret123');
        const value = await provider.get('dev', 'db/pass');
        expect(value).toBe('secret123');
    });

    it('creates a gcp-sm provider', () => {
        const provider = createProvider(
            { adapter: 'gcp-sm', project: 'my-project' },
            tmpDir,
            'myapp'
        );
        expect(provider).toBeInstanceOf(GcpSmProvider);
    });

    it('creates an aws-sm provider', () => {
        const provider = createProvider({ adapter: 'aws-sm' }, tmpDir, 'myapp');
        expect(provider).toBeInstanceOf(AwsSmProvider);
    });

    it('throws for an unknown adapter', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(() =>
            createProvider({ adapter: 'unknown-adapter' } as any, tmpDir, 'myapp')
        ).toThrow();
    });
});

describe('resolveProvider', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-resolve-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('uses env-level provider when defined', () => {
        const envDef = {
            imports: [],
            values: {},
            provider: { adapter: 'gcp-sm' as const, project: 'env-project' }
        };
        const globalConfig = {
            name: 'test',
            provider: { adapter: 'local' as const }
        };

        const provider = resolveProvider(envDef, globalConfig, tmpDir);
        expect(provider).toBeInstanceOf(GcpSmProvider);
    });

    it('falls back to global config when env has no provider', () => {
        const envDef = {
            imports: [],
            values: {}
        };
        const globalConfig = {
            name: 'test',
            provider: { adapter: 'local' as const }
        };

        const provider = resolveProvider(envDef, globalConfig, tmpDir);
        expect(provider).toBeInstanceOf(LocalProvider);
    });
});
