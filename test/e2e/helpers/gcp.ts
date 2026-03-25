import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

export const GCP_PROJECT = process.env.KEYSHELF_GCP_PROJECT;

export function createGcpClient() {
  return new SecretManagerServiceClient();
}

export async function writeGcpFixture(
  root: string,
  envName: string,
  project: string,
) {
  await writeFile(
    join(root, 'keyshelf.yaml'),
    ['keys:', '  db:', '    host: localhost', '    password: !secret ""'].join(
      '\n',
    ),
  );

  await mkdir(join(root, '.keyshelf'), { recursive: true });
  await writeFile(
    join(root, '.keyshelf', `${envName}.yaml`),
    [
      'default-provider:',
      '  name: gcp',
      `  project: ${project}`,
      'keys:',
      '  db:',
      '    host: prod-db',
    ].join('\n'),
  );

  await writeFile(
    join(root, '.env.keyshelf'),
    ['DB_HOST=db/host', 'DB_PASSWORD=db/password'].join('\n'),
  );
}

export async function deleteSecrets(
  client: SecretManagerServiceClient,
  secrets: string[],
) {
  for (const name of secrets) {
    try {
      await client.deleteSecret({ name });
    } catch {
      // best-effort cleanup
    }
  }
}
