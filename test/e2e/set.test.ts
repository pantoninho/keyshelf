import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { Decrypter } from 'age-encryption';
import {
  GCP_PROJECT,
  createGcpClient,
  writeGcpFixture,
  deleteSecrets,
} from './helpers/gcp.js';
import { writeAgeFixture } from './helpers/age.js';

const CLI = join(import.meta.dirname, '..', '..', 'bin', 'keyshelf.ts');
const TSX = join(
  import.meta.dirname,
  '..',
  '..',
  'node_modules',
  '.bin',
  'tsx',
);

describe('keyshelf set (age)', () => {
  let root: string;
  let identityFile: string;
  let secretsDir: string;
  const envName = 'age-test';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'keyshelf-e2e-age-set-'));
    await writeAgeFixture(root, envName);
    identityFile = join(root, 'key.txt');
    secretsDir = join(root, '.keyshelf', 'secrets');
  });

  async function decryptFile(filePath: string): Promise<string> {
    const identity = await readFile(identityFile, 'utf-8');
    const ciphertext = await readFile(filePath);
    const decrypter = new Decrypter();
    decrypter.addIdentity(identity.trim());
    return await decrypter.decrypt(ciphertext, 'text');
  }

  it('creates an encrypted secret file', async () => {
    execFileSync(
      TSX,
      [
        CLI,
        'set',
        '--env',
        envName,
        '--provider',
        'age',
        '--value',
        'age-secret-value',
        'db/password',
      ],
      { cwd: root, encoding: 'utf-8' },
    );

    const plaintext = await decryptFile(join(secretsDir, 'db_password.age'));
    expect(plaintext).toBe('age-secret-value');
  });

  it('overwrites an existing age secret', async () => {
    execFileSync(
      TSX,
      [
        CLI,
        'set',
        '--env',
        envName,
        '--provider',
        'age',
        '--value',
        'updated-age-value',
        'db/password',
      ],
      { cwd: root, encoding: 'utf-8' },
    );

    const plaintext = await decryptFile(join(secretsDir, 'db_password.age'));
    expect(plaintext).toBe('updated-age-value');
  });
});

describe.skipIf(!GCP_PROJECT)('keyshelf set (gcp)', { timeout: 30_000 }, () => {
  let root: string;
  let client: SecretManagerServiceClient;
  const envName = `test${Date.now()}`;
  const createdSecrets: string[] = [];

  beforeAll(async () => {
    client = createGcpClient();
    root = await mkdtemp(join(tmpdir(), 'keyshelf-e2e-gcp-set-'));
    await writeGcpFixture(root, envName, GCP_PROJECT!);
  });

  afterAll(async () => {
    await deleteSecrets(client, createdSecrets);
  });

  it('creates a secret in GCP', async () => {
    execFileSync(
      TSX,
      [
        CLI,
        'set',
        '--env',
        envName,
        '--provider',
        'gcp',
        '--value',
        'e2e-secret-value',
        'db/password',
      ],
      { cwd: root, encoding: 'utf-8' },
    );

    const secretName = `projects/${GCP_PROJECT}/secrets/keyshelf__${envName}__db__password`;
    createdSecrets.push(secretName);

    const [version] = await client.accessSecretVersion({
      name: `${secretName}/versions/latest`,
    });
    expect(version.payload?.data?.toString()).toBe('e2e-secret-value');
  });

  it('overwrites an existing secret', async () => {
    execFileSync(
      TSX,
      [
        CLI,
        'set',
        '--env',
        envName,
        '--provider',
        'gcp',
        '--value',
        'updated-value',
        'db/password',
      ],
      { cwd: root, encoding: 'utf-8' },
    );

    const secretName = `projects/${GCP_PROJECT}/secrets/keyshelf__${envName}__db__password`;

    const [version] = await client.accessSecretVersion({
      name: `${secretName}/versions/latest`,
    });
    expect(version.payload?.data?.toString()).toBe('updated-value');
  });
});
