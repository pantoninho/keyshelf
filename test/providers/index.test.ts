import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createProvider } from '../../src/providers/index.js';

describe('createProvider', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyshelf-factory-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('creates a working local provider', async () => {
        const provider = createProvider({ adapter: 'local' }, tmpDir);

        await provider.set('dev', 'db/pass', 'secret123');
        const value = await provider.get('dev', 'db/pass');
        expect(value).toBe('secret123');
    });

    it('creates a gcp-sm provider', () => {
        const provider = createProvider({ adapter: 'gcp-sm', project: 'my-project' }, tmpDir);
        expect(provider).toBeDefined();
    });
});
