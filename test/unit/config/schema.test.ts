import { describe, it, expect } from 'vitest';
import { parseSchema } from '../../../src/config/schema.js';

describe('parseSchema', () => {
  it('parses flat config keys with defaults', () => {
    const content = 'keys:\n  db/host: localhost\n  db/port: 5432';
    const { keys } = parseSchema(content);
    expect(keys).toEqual([
      {
        path: 'db/host',
        isSecret: false,
        optional: false,
        defaultValue: 'localhost',
      },
      {
        path: 'db/port',
        isSecret: false,
        optional: false,
        defaultValue: '5432',
      },
    ]);
  });

  it('parses nested config keys', () => {
    const content = 'keys:\n  db:\n    host: localhost\n    port: 5432';
    const { keys } = parseSchema(content);
    expect(keys).toEqual([
      {
        path: 'db/host',
        isSecret: false,
        optional: false,
        defaultValue: 'localhost',
      },
      {
        path: 'db/port',
        isSecret: false,
        optional: false,
        defaultValue: '5432',
      },
    ]);
  });

  it('detects secrets with !secret tag', () => {
    const content = 'keys:\n  db/password: !secret ""';
    const { keys } = parseSchema(content);
    expect(keys).toEqual([
      { path: 'db/password', isSecret: true, optional: false },
    ]);
  });

  it('detects optional secrets', () => {
    const content = 'keys:\n  analytics/key: !secret\n    optional: true';
    const { keys } = parseSchema(content);
    expect(keys).toEqual([
      { path: 'analytics/key', isSecret: true, optional: true },
    ]);
  });

  it('handles mixed config and secrets', () => {
    const content = [
      'keys:',
      '  db:',
      '    host: localhost',
      '    password: !secret ""',
      '  app:',
      '    name: myapp',
    ].join('\n');
    const { keys } = parseSchema(content);
    expect(keys).toHaveLength(3);
    expect(keys.find((d) => d.path === 'db/host')).toEqual({
      path: 'db/host',
      isSecret: false,
      optional: false,
      defaultValue: 'localhost',
    });
    expect(keys.find((d) => d.path === 'db/password')).toEqual({
      path: 'db/password',
      isSecret: true,
      optional: false,
    });
    expect(keys.find((d) => d.path === 'app/name')).toEqual({
      path: 'app/name',
      isSecret: false,
      optional: false,
      defaultValue: 'myapp',
    });
  });

  it('treats provider-specific tags as secrets', () => {
    const content = 'keys:\n  api/key: !gcp ""';
    const { keys } = parseSchema(content);
    expect(keys).toEqual([
      { path: 'api/key', isSecret: true, optional: false },
    ]);
  });

  it('throws when keys: block is missing', () => {
    expect(() => parseSchema('db: localhost')).toThrow(
      'must contain a "keys:" block',
    );
  });

  it('throws for empty input', () => {
    expect(() => parseSchema('')).toThrow('must contain a "keys:" block');
  });

  it('returns empty keys for empty keys: block', () => {
    const content = 'keys: {}';
    const { keys } = parseSchema(content);
    expect(keys).toEqual([]);
  });

  it('handles null values in keys', () => {
    const content = 'keys:\n  key: null';
    const { keys } = parseSchema(content);
    expect(keys).toEqual([
      {
        path: 'key',
        isSecret: false,
        optional: false,
        defaultValue: undefined,
      },
    ]);
  });

  it('parses global provider config', () => {
    const content = [
      'default-provider:',
      '  name: age',
      '  identityFile: ./key.txt',
      '  secretsDir: ./secrets',
      'keys:',
      '  db/host: localhost',
    ].join('\n');
    const { config } = parseSchema(content);
    expect(config.provider).toEqual({
      name: 'age',
      options: { identityFile: './key.txt', secretsDir: './secrets' },
    });
  });

  it('returns no provider when not specified', () => {
    const content = 'keys:\n  db/host: localhost';
    const { config } = parseSchema(content);
    expect(config.provider).toBeUndefined();
  });
});
