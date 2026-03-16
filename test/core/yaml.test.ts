import { describe, it, expect } from 'vitest';
import { SecretRef } from '../../src/core/types.js';
import { parseEnvironment, serializeEnvironment } from '../../src/core/yaml.js';

describe('YAML parser', () => {
    describe('parsing', () => {
        it('parses plain YAML values', () => {
            const result = parseEnvironment('values:\n  database:\n    host: localhost');
            expect(result.values).toEqual({ database: { host: 'localhost' } });
        });

        it('parses !secret tag into SecretRef', () => {
            const result = parseEnvironment('values:\n  password: !secret database/password');
            expect(result.values.password).toBeInstanceOf(SecretRef);
            expect((result.values.password as SecretRef).path).toBe('database/password');
        });

        it('parses nested !secret tags', () => {
            const result = parseEnvironment('values:\n  db:\n    password: !secret db/pass');
            const db = result.values.db as Record<string, unknown>;
            expect(db.password).toBeInstanceOf(SecretRef);
            expect((db.password as SecretRef).path).toBe('db/pass');
        });

        it('parses environment definition with imports', () => {
            const result = parseEnvironment('imports:\n  - base\nvalues:\n  key: val');
            expect(result.imports).toEqual(['base']);
            expect(result.values).toEqual({ key: 'val' });
        });

        it('parses environment definition with multiple imports', () => {
            const result = parseEnvironment('imports:\n  - base\n  - common\nvalues:\n  key: val');
            expect(result.imports).toEqual(['base', 'common']);
        });

        it('parses environment definition without imports', () => {
            const result = parseEnvironment('values:\n  key: val');
            expect(result.imports).toEqual([]);
            expect(result.values).toEqual({ key: 'val' });
        });
    });

    describe('serialization', () => {
        it('serializes plain values to YAML', () => {
            const yaml = serializeEnvironment({
                imports: [],
                values: { database: { host: 'localhost' } }
            });
            const result = parseEnvironment(yaml);
            expect(result.values).toEqual({ database: { host: 'localhost' } });
        });

        it('serializes SecretRef back to !secret tag', () => {
            const yaml = serializeEnvironment({
                imports: [],
                values: { password: new SecretRef('database/password') }
            });
            expect(yaml).toContain('!secret database/password');
        });

        it('serializes imports', () => {
            const yaml = serializeEnvironment({
                imports: ['base', 'common'],
                values: { key: 'val' }
            });
            const result = parseEnvironment(yaml);
            expect(result.imports).toEqual(['base', 'common']);
        });

        it('omits imports key when imports array is empty', () => {
            const yaml = serializeEnvironment({
                imports: [],
                values: { key: 'val' }
            });
            expect(yaml).not.toContain('imports');
        });
    });

    describe('provider', () => {
        it('parses environment with provider block', () => {
            const result = parseEnvironment(
                'provider:\n  adapter: gcp-sm\n  project: my-project\nvalues:\n  key: val'
            );
            expect(result.provider).toEqual({ adapter: 'gcp-sm', project: 'my-project' });
        });

        it('parses environment without provider block', () => {
            const result = parseEnvironment('values:\n  key: val');
            expect(result.provider).toBeUndefined();
        });

        it('serializes provider block', () => {
            const yaml = serializeEnvironment({
                imports: [],
                values: { key: 'val' },
                provider: { adapter: 'gcp-sm', project: 'my-project' }
            });
            expect(yaml).toContain('adapter: gcp-sm');
            expect(yaml).toContain('project: my-project');
        });

        it('omits provider key when provider is undefined', () => {
            const yaml = serializeEnvironment({
                imports: [],
                values: { key: 'val' }
            });
            expect(yaml).not.toContain('provider');
        });

        it('round-trips provider block', () => {
            const original = serializeEnvironment({
                imports: [],
                values: { key: 'val' },
                provider: { adapter: 'gcp-sm', project: 'my-project' }
            });
            const reparsed = parseEnvironment(original);
            expect(reparsed.provider).toEqual({ adapter: 'gcp-sm', project: 'my-project' });
        });
    });

    describe('env section', () => {
        it('parses env section into Record<string, string>', () => {
            const result = parseEnvironment(
                'env:\n  DATABASE_URL: database/url\n  API_KEY: api/key\nvalues:\n  key: val'
            );
            expect(result.env).toEqual({ DATABASE_URL: 'database/url', API_KEY: 'api/key' });
        });

        it('returns undefined env when env section is absent', () => {
            const result = parseEnvironment('values:\n  key: val');
            expect(result.env).toBeUndefined();
        });

        it('serializes env section between provider and values', () => {
            const serialized = serializeEnvironment({
                imports: [],
                env: { DATABASE_URL: 'database/url' },
                values: { key: 'val' }
            });
            expect(serialized).toContain('DATABASE_URL: database/url');
            const providerIdx = serialized.indexOf('provider:');
            const envIdx = serialized.indexOf('env:');
            const valuesIdx = serialized.indexOf('values:');
            // env comes after provider (or start) and before values
            expect(envIdx).toBeLessThan(valuesIdx);
            if (providerIdx !== -1) {
                expect(envIdx).toBeGreaterThan(providerIdx);
            }
        });

        it('omits env key when env is undefined', () => {
            const serialized = serializeEnvironment({ imports: [], values: { key: 'val' } });
            expect(serialized).not.toContain('env:');
        });

        it('round-trips env section', () => {
            const original: Parameters<typeof serializeEnvironment>[0] = {
                imports: [],
                env: { DATABASE_URL: 'database/url', API_KEY: 'api/key' },
                values: { host: 'localhost' }
            };
            const serialized = serializeEnvironment(original);
            const reparsed = parseEnvironment(serialized);
            expect(reparsed.env).toEqual({ DATABASE_URL: 'database/url', API_KEY: 'api/key' });
            expect(reparsed.values).toEqual({ host: 'localhost' });
        });
    });

    describe('round-trip', () => {
        it('parse then serialize preserves !secret refs', () => {
            const original = 'values:\n  password: !secret database/password\n';
            const parsed = parseEnvironment(original);
            const serialized = serializeEnvironment(parsed);
            const reparsed = parseEnvironment(serialized);

            expect(reparsed.values.password).toBeInstanceOf(SecretRef);
            expect((reparsed.values.password as SecretRef).path).toBe('database/password');
        });

        it('parse then serialize preserves plain values and secrets together', () => {
            const original = 'values:\n  db:\n    host: localhost\n    password: !secret db/pass\n';
            const parsed = parseEnvironment(original);
            const serialized = serializeEnvironment(parsed);
            const reparsed = parseEnvironment(serialized);

            const db = reparsed.values.db as Record<string, unknown>;
            expect(db.host).toBe('localhost');
            expect(db.password).toBeInstanceOf(SecretRef);
            expect((db.password as SecretRef).path).toBe('db/pass');
        });

        it('parse then serialize preserves imports', () => {
            const original = 'imports:\n  - base\nvalues:\n  key: val\n';
            const parsed = parseEnvironment(original);
            const serialized = serializeEnvironment(parsed);
            const reparsed = parseEnvironment(serialized);

            expect(reparsed.imports).toEqual(['base']);
            expect(reparsed.values).toEqual({ key: 'val' });
        });
    });
});
