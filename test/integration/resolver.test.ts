import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseSchema } from '../../src/config/schema.js';
import { parseEnvironment } from '../../src/config/environment.js';
import { resolve, validate } from '../../src/resolver/index.js';
import { ProviderRegistry } from '../../src/providers/registry.js';
import { PlaintextProvider } from '../../src/providers/plaintext.js';
import { AgeProvider, generateIdentity } from '../../src/providers/age.js';
import { GcpSmProvider } from '../../src/providers/gcp-sm.js';

describe('full resolution flow', () => {
  let tmpDir: string;
  let identityFile: string;
  let secretsDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'keyshelf-flow-'));
    identityFile = join(tmpDir, 'key.txt');
    secretsDir = join(tmpDir, 'secrets');
    const identity = await generateIdentity();
    await writeFile(identityFile, identity);
  });

  it('resolves schema + env with plaintext overrides', async () => {
    const { keys: schema } = parseSchema(
      ['keys:', '  db:', '    host: localhost', '    port: 5432'].join('\n'),
    );
    const env = parseEnvironment(
      ['keys:', '  db:', '    host: prod-db.example.com'].join('\n'),
    );
    const registry = new ProviderRegistry();
    registry.register(new PlaintextProvider());

    const result = await resolve({ schema, env, envName: 'test', registry });
    expect(result).toEqual([
      { path: 'db/host', value: 'prod-db.example.com' },
      { path: 'db/port', value: '5432' },
    ]);
  });

  it('resolves schema + env with age provider', async () => {
    const { keys: schema } = parseSchema(
      [
        'keys:',
        '  db:',
        '    host: localhost',
        '    password: !secret ""',
      ].join('\n'),
    );
    const env = parseEnvironment(
      [
        'default-provider:',
        '  name: age',
        `  identityFile: ${identityFile}`,
        `  secretsDir: ${secretsDir}`,
        'keys:',
        '  db:',
        '    host: prod-db',
      ].join('\n'),
    );

    const registry = new ProviderRegistry();
    const ageProvider = new AgeProvider();
    registry.register(ageProvider);

    // Pre-store the secret
    await ageProvider.set(
      {
        keyPath: 'db/password',
        envName: 'test',
        config: { identityFile, secretsDir },
      },
      'supersecret',
    );

    const result = await resolve({ schema, env, envName: 'test', registry });
    expect(result).toEqual([
      { path: 'db/host', value: 'prod-db' },
      { path: 'db/password', value: 'supersecret' },
    ]);
  });

  it('validate reports all missing secrets at once', async () => {
    const { keys: schema } = parseSchema(
      [
        'keys:',
        '  db:',
        '    host: localhost',
        '    password: !secret ""',
        '  api:',
        '    key: !secret ""',
      ].join('\n'),
    );
    const env = parseEnvironment('');
    const registry = new ProviderRegistry();

    const errors = await validate({ schema, env, envName: 'test', registry });
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.path)).toEqual(['db/password', 'api/key']);
  });

  describe('with GCP provider (mocked)', () => {
    function mockClient() {
      return {
        accessSecretVersion: vi.fn(),
        getSecret: vi.fn(),
        createSecret: vi.fn(),
        addSecretVersion: vi.fn(),
      };
    }

    it('resolves secrets via gcp default provider', async () => {
      const client = mockClient();
      client.accessSecretVersion.mockResolvedValue([
        { payload: { data: Buffer.from('db-secret') } },
      ]);

      const { keys: schema } = parseSchema(
        [
          'keys:',
          '  db:',
          '    host: localhost',
          '    password: !secret ""',
        ].join('\n'),
      );
      const env = parseEnvironment(
        [
          'default-provider:',
          '  name: gcp',
          '  project: my-proj',
          'keys:',
          '  db:',
          '    host: prod-db',
        ].join('\n'),
      );

      const registry = new ProviderRegistry();
      registry.register(new GcpSmProvider(client as any));

      const result = await resolve({
        schema,
        env,
        envName: 'prod',
        registry,
      });

      expect(result).toEqual([
        { path: 'db/host', value: 'prod-db' },
        { path: 'db/password', value: 'db-secret' },
      ]);
      expect(client.accessSecretVersion).toHaveBeenCalledWith({
        name: 'projects/my-proj/secrets/keyshelf__prod__db__password/versions/latest',
      });
    });

    it('resolves per-key !gcp override with different project', async () => {
      const client = mockClient();
      client.accessSecretVersion.mockResolvedValue([
        { payload: { data: Buffer.from('other-secret') } },
      ]);

      const { keys: schema } = parseSchema(
        ['keys:', '  api:', '    key: !secret ""'].join('\n'),
      );
      const env = parseEnvironment(
        ['keys:', '  api:', '    key: !gcp', '      project: other-proj'].join(
          '\n',
        ),
      );

      const registry = new ProviderRegistry();
      registry.register(new GcpSmProvider(client as any));

      const result = await resolve({
        schema,
        env,
        envName: 'staging',
        registry,
      });

      expect(result).toEqual([{ path: 'api/key', value: 'other-secret' }]);
      expect(client.accessSecretVersion).toHaveBeenCalledWith({
        name: 'projects/other-proj/secrets/keyshelf__staging__api__key/versions/latest',
      });
    });

    it('env override takes precedence over provider', async () => {
      const client = mockClient();

      const { keys: schema } = parseSchema(
        ['keys:', '  db:', '    password: !secret ""'].join('\n'),
      );
      const env = parseEnvironment(
        [
          'default-provider:',
          '  name: gcp',
          '  project: my-proj',
          'keys:',
          '  db:',
          '    password: plaintext-override',
        ].join('\n'),
      );

      const registry = new ProviderRegistry();
      registry.register(new GcpSmProvider(client as any));

      const result = await resolve({
        schema,
        env,
        envName: 'dev',
        registry,
      });

      expect(result).toEqual([
        { path: 'db/password', value: 'plaintext-override' },
      ]);
      expect(client.accessSecretVersion).not.toHaveBeenCalled();
    });
  });
});
