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
