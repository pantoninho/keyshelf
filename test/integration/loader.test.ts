import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findRootDir, loadConfig } from '../../src/config/loader.js';
import { resolve } from '../../src/resolver/index.js';
import { ProviderRegistry } from '../../src/providers/registry.js';
import { PlaintextProvider } from '../../src/providers/plaintext.js';

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'keyshelf-loader-'));

  await writeFile(
    join(root, 'keyshelf.yaml'),
    [
      'keys:',
      '  db:',
      '    host: localhost',
      '    port: 5432',
      '    password: !secret ""',
    ].join('\n'),
  );

  await mkdir(join(root, '.keyshelf'));
  await writeFile(
    join(root, '.keyshelf', 'production.yaml'),
    ['keys:', '  db:', '    host: prod-db.example.com'].join('\n'),
  );

  const appDir = join(root, 'apps', 'api');
  await mkdir(appDir, { recursive: true });
  await writeFile(
    join(appDir, '.env.keyshelf'),
    ['DB_HOST=db/host', 'DB_PORT=db/port', 'DB_PASSWORD=db/password'].join(
      '\n',
    ),
  );

  return { root, appDir };
}

describe('findRootDir', () => {
  it('finds root from project directory', async () => {
    const { root } = await createFixture();
    expect(findRootDir(root)).toBe(root);
  });

  it('finds root from nested app directory', async () => {
    const { root, appDir } = await createFixture();
    expect(findRootDir(appDir)).toBe(root);
  });

  it('throws when no keyshelf.yaml found', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'keyshelf-empty-'));
    expect(() => findRootDir(empty)).toThrow('Could not find keyshelf.yaml');
  });
});

describe('loadConfig', () => {
  let root: string;
  let appDir: string;

  beforeEach(async () => {
    ({ root, appDir } = await createFixture());
  });

  it('loads schema, env, and app mapping', async () => {
    const config = await loadConfig(appDir, 'production');

    expect(config.rootDir).toBe(root);
    expect(config.schema).toHaveLength(3);
    expect(config.schema.map((k) => k.path)).toEqual([
      'db/host',
      'db/port',
      'db/password',
    ]);
    expect(config.env.overrides['db/host']).toBe('prod-db.example.com');
    expect(config.appMapping).toEqual([
      { envVar: 'DB_HOST', keyPath: 'db/host' },
      { envVar: 'DB_PORT', keyPath: 'db/port' },
      { envVar: 'DB_PASSWORD', keyPath: 'db/password' },
    ]);
  });

  it('throws for missing environment file', async () => {
    await expect(loadConfig(appDir, 'staging')).rejects.toThrow(
      'Environment file not found',
    );
  });

  it('throws for missing app mapping file', async () => {
    const noMappingDir = join(root, 'apps', 'other');
    await mkdir(noMappingDir, { recursive: true });
    await expect(loadConfig(noMappingDir, 'production')).rejects.toThrow(
      'App mapping file not found',
    );
  });

  it('loads mapping from custom mappingFile path', async () => {
    const customMap = join(root, 'custom', 'my-map');
    await mkdir(join(root, 'custom'), { recursive: true });
    await writeFile(customMap, 'DB_HOST=db/host\n');
    const config = await loadConfig(appDir, 'production', {
      mappingFile: customMap,
    });
    expect(config.appMapping).toEqual([
      { envVar: 'DB_HOST', keyPath: 'db/host' },
    ]);
  });

  it('custom mappingFile takes precedence over default .env.keyshelf', async () => {
    const customMap = join(root, 'alt-map');
    await writeFile(customMap, 'ONLY_HOST=db/host\n');
    const config = await loadConfig(appDir, 'production', {
      mappingFile: customMap,
    });
    // Default .env.keyshelf has DB_HOST, DB_PORT, DB_PASSWORD — custom has only ONLY_HOST
    expect(config.appMapping).toEqual([
      { envVar: 'ONLY_HOST', keyPath: 'db/host' },
    ]);
  });

  it('throws for missing custom mappingFile with correct path', async () => {
    const missingPath = join(root, 'does-not-exist');
    await expect(
      loadConfig(appDir, 'production', { mappingFile: missingPath }),
    ).rejects.toThrow(missingPath);
  });

  it('resolves keys end-to-end with custom mappingFile', async () => {
    // Use a schema without secrets to avoid needing a secret provider
    await writeFile(
      join(root, 'keyshelf.yaml'),
      ['keys:', '  db:', '    host: localhost', '    port: 5432'].join('\n'),
    );
    const customMap = join(root, 'api-map');
    await writeFile(customMap, 'HOST=db/host\n');
    const config = await loadConfig(appDir, 'production', {
      mappingFile: customMap,
    });
    const registry = new ProviderRegistry();
    registry.register(new PlaintextProvider());
    const resolved = await resolve({
      schema: config.schema,
      env: config.env,
      envName: 'production',
      registry,
    });
    const resolvedMap = new Map(resolved.map((r) => [r.path, r.value]));
    const envVars: Record<string, string> = {};
    for (const mapping of config.appMapping) {
      const value = resolvedMap.get(mapping.keyPath);
      if (value !== undefined) {
        envVars[mapping.envVar] = value;
      }
    }
    expect(envVars).toEqual({ HOST: 'prod-db.example.com' });
  });

  it('loads from root directory as app dir', async () => {
    await writeFile(join(root, '.env.keyshelf'), 'DB_HOST=db/host\n');
    const config = await loadConfig(root, 'production');
    expect(config.rootDir).toBe(root);
    expect(config.appMapping).toEqual([
      { envVar: 'DB_HOST', keyPath: 'db/host' },
    ]);
  });

  it('uses global provider when env has none', async () => {
    await writeFile(
      join(root, 'keyshelf.yaml'),
      [
        'default-provider:',
        '  name: age',
        '  identityFile: ./key.txt',
        '  secretsDir: ./secrets',
        'keys:',
        '  db/password: !secret ""',
      ].join('\n'),
    );
    // production.yaml has no provider block
    const config = await loadConfig(appDir, 'production');
    expect(config.env.defaultProvider).toEqual({
      name: 'age',
      options: { identityFile: './key.txt', secretsDir: './secrets' },
    });
  });

  it('merges global provider options with env provider options', async () => {
    await writeFile(
      join(root, 'keyshelf.yaml'),
      [
        'default-provider:',
        '  name: age',
        '  identityFile: ./key.txt',
        '  secretsDir: ./secrets',
        'keys:',
        '  db/password: !secret ""',
      ].join('\n'),
    );
    await writeFile(
      join(root, '.keyshelf', 'production.yaml'),
      ['default-provider:', '  name: age', '  secretsDir: ./prod-secrets'].join('\n'),
    );
    const config = await loadConfig(appDir, 'production');
    expect(config.env.defaultProvider).toEqual({
      name: 'age',
      options: {
        identityFile: './key.txt',
        secretsDir: './prod-secrets',
      },
    });
  });

  it('env provider name takes precedence over global', async () => {
    await writeFile(
      join(root, 'keyshelf.yaml'),
      [
        'default-provider:',
        '  name: age',
        '  identityFile: ./key.txt',
        'keys:',
        '  db/password: !secret ""',
      ].join('\n'),
    );
    await writeFile(
      join(root, '.keyshelf', 'production.yaml'),
      ['default-provider:', '  name: gcp', '  project: my-project'].join('\n'),
    );
    const config = await loadConfig(appDir, 'production');
    expect(config.env.defaultProvider).toEqual({
      name: 'gcp',
      options: { project: 'my-project' },
    });
  });
});
