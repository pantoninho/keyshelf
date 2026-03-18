import {
  SecretsManagerClient,
  CreateSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceExistsException
} from "@aws-sdk/client-secrets-manager";
import type { Provider, ProviderContext } from "@/types";

/** Derive a secret name from provider context */
export function buildSecretName(context: ProviderContext): string {
  return `${context.projectName}/${context.env}/${context.keyPath}`;
}

async function getSecret(reference: string): Promise<string> {
  const client = new SecretsManagerClient({});
  const result = await client.send(new GetSecretValueCommand({ SecretId: reference }));

  if (result.SecretString === undefined) {
    throw new Error(
      `Secret '${reference}' is a binary secret, which is not supported. Store a string secret instead.`
    );
  }

  return result.SecretString;
}

async function upsertSecret(secretName: string, value: string): Promise<string> {
  const client = new SecretsManagerClient({});

  try {
    await client.send(new CreateSecretCommand({ Name: secretName, SecretString: value }));
  } catch (err) {
    if (!(err instanceof ResourceExistsException)) throw err;
    await client.send(new PutSecretValueCommand({ SecretId: secretName, SecretString: value }));
  }

  return secretName;
}

/** AWS Secrets Manager provider */
export const awsSmProvider: Provider = {
  async get(reference: string, _context: ProviderContext): Promise<string> {
    return getSecret(reference);
  },

  async set(value: string, context: ProviderContext): Promise<string> {
    const secretName = buildSecretName(context);
    return upsertSecret(secretName, value);
  }
};
