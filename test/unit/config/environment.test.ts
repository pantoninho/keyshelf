import { describe, it, expect } from 'vitest';
import { parseEnvironment } from '../../../src/config/environment.js';

describe('parseEnvironment', () => {
  it('parses plaintext overrides', () => {
    const content = 'keys:\n  db/host: prod-db.example.com\n  db/port: 5433';
    const env = parseEnvironment(content);
    expect(env.defaultProvider).toBeUndefined();
    expect(env.overrides).toEqual({
      'db/host': 'prod-db.example.com',
      'db/port': 5433,
    });
  });

  it('parses nested overrides', () => {
    const content = 'keys:\n  db:\n    host: prod-db.example.com';
    const env = parseEnvironment(content);
    expect(env.overrides).toEqual({
      'db/host': 'prod-db.example.com',
    });
  });

  it('parses provider block', () => {
    const content = ['default-provider:', '  name: gcp', '  project: my-project'].join(
      '\n',
    );
    const env = parseEnvironment(content);
    expect(env.defaultProvider).toEqual({
      name: 'gcp',
      options: { project: 'my-project' },
    });
    expect(env.overrides).toEqual({});
  });

  it('parses tagged value overrides', () => {
    const content = 'keys:\n  db/password: !gcp\n    name: db-pass';
    const env = parseEnvironment(content);
    expect(env.overrides['db/password']).toEqual({
      tag: 'gcp',
      config: { name: 'db-pass' },
    });
  });

  it('parses bare tagged value overrides', () => {
    const content = 'keys:\n  db/password: !gcp ""';
    const env = parseEnvironment(content);
    expect(env.overrides['db/password']).toEqual({
      tag: 'gcp',
      config: {},
    });
  });

  it('parses full environment file with provider and overrides', () => {
    const content = [
      'default-provider:',
      '  name: gcp',
      '  project: my-project',
      'keys:',
      '  db:',
      '    host: prod-db.example.com',
      '    password: !gcp',
      '      name: db-password',
      '  app/name: prod-app',
    ].join('\n');
    const env = parseEnvironment(content);
    expect(env.defaultProvider).toEqual({
      name: 'gcp',
      options: { project: 'my-project' },
    });
    expect(env.overrides['db/host']).toBe('prod-db.example.com');
    expect(env.overrides['db/password']).toEqual({
      tag: 'gcp',
      config: { name: 'db-password' },
    });
    expect(env.overrides['app/name']).toBe('prod-app');
  });

  it('skips null overrides', () => {
    const content = 'keys:\n  key: null';
    const env = parseEnvironment(content);
    expect(env.overrides).toEqual({});
  });

  it('returns empty config for empty input', () => {
    const env = parseEnvironment('');
    expect(env.defaultProvider).toBeUndefined();
    expect(env.overrides).toEqual({});
  });

  it('returns empty overrides when no keys block', () => {
    const content = 'default-provider:\n  name: gcp\n  project: my-project';
    const env = parseEnvironment(content);
    expect(env.defaultProvider).toEqual({
      name: 'gcp',
      options: { project: 'my-project' },
    });
    expect(env.overrides).toEqual({});
  });
});
