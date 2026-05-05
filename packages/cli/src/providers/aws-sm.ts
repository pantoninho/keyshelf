import {
  CreateSecretCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
  GetSecretValueCommand,
  ListSecretsCommand,
  PutSecretValueCommand,
  ResourceExistsException,
  ResourceNotFoundException,
  SecretsManagerClient
} from "@aws-sdk/client-secrets-manager";
import { parseStoredSecretSegments } from "./_paths.js";
import type {
  Provider,
  ProviderContext,
  ProviderListContext,
  StorageScope,
  StoredKey
} from "./types.js";

export interface AwsSmProviderOptions {
  region?: string;
  kmsKeyId?: string;
}

export class AwsAuthError extends Error {
  constructor(cause?: Error) {
    super(
      "AWS authentication failed. Run 'aws sso login' or check your AWS credentials (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY env vars or ~/.aws/credentials)."
    );
    this.name = "AwsAuthError";
    this.cause = cause;
  }
}

export class AwsRegionError extends Error {
  constructor(keyPath: string, cause?: Error) {
    super(
      `aws provider could not resolve a region for "${keyPath}". Set AWS_REGION, configure a default in your AWS profile, or pass region: '...' in the binding.`
    );
    this.name = "AwsRegionError";
    this.cause = cause;
  }
}

const AUTH_ERROR_NAMES = new Set([
  "CredentialsProviderError",
  "ExpiredTokenException",
  "ExpiredToken",
  "UnrecognizedClientException",
  "InvalidSignatureException",
  "InvalidClientTokenId",
  "SignatureDoesNotMatch"
]);

function isAuthError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (AUTH_ERROR_NAMES.has(err.name)) return true;
  const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return status === 401 || status === 403;
}

function isRegionMissingError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("Region is missing");
}

const DEFAULT_REGION_KEY = "__default__";

export function toSecretId(
  keyshelfName: string | undefined,
  envName: string | undefined,
  keyPath: string
): string {
  const segments = ["keyshelf"];
  if (keyshelfName !== undefined) segments.push(keyshelfName);
  if (envName !== undefined && envName !== "") segments.push(envName);
  segments.push(keyPath);
  return segments.join("/");
}

export class AwsSmProvider implements Provider {
  name = "aws";
  storageScope: StorageScope = "perEnv";

  private clients = new Map<string, SecretsManagerClient>();
  private injectedClient: SecretsManagerClient | undefined;

  constructor(client?: SecretsManagerClient) {
    this.injectedClient = client;
  }

  private resolveOptions(ctx: ProviderContext | ProviderListContext): AwsSmProviderOptions {
    const opts: AwsSmProviderOptions = {};
    if (typeof ctx.config.region === "string") opts.region = ctx.config.region;
    if (typeof ctx.config.kmsKeyId === "string") opts.kmsKeyId = ctx.config.kmsKeyId;
    return opts;
  }

  private getClient(opts: AwsSmProviderOptions): SecretsManagerClient {
    if (this.injectedClient) return this.injectedClient;
    const key = opts.region ?? DEFAULT_REGION_KEY;
    const existing = this.clients.get(key);
    if (existing) return existing;
    const client = new SecretsManagerClient(opts.region ? { region: opts.region } : {});
    this.clients.set(key, client);
    return client;
  }

  private async send<T>(
    opts: AwsSmProviderOptions,
    keyPath: string,
    op: () => Promise<T>
  ): Promise<T> {
    try {
      return await op();
    } catch (err) {
      if (isAuthError(err)) throw new AwsAuthError(err as Error);
      if (isRegionMissingError(err)) throw new AwsRegionError(keyPath, err as Error);
      throw err;
    }
  }

  async resolve(ctx: ProviderContext): Promise<string> {
    const opts = this.resolveOptions(ctx);
    const client = this.getClient(opts);
    const secretId = toSecretId(ctx.keyshelfName, ctx.envName, ctx.keyPath);

    const result = await this.send(opts, ctx.keyPath, () =>
      client.send(new GetSecretValueCommand({ SecretId: secretId }))
    );

    if (typeof result.SecretString === "string" && result.SecretString.length > 0) {
      return result.SecretString;
    }
    if (result.SecretBinary && result.SecretBinary.byteLength > 0) {
      return Buffer.from(result.SecretBinary).toString("utf-8");
    }
    throw new Error(`Secret "${secretId}" has no payload`);
  }

  async validate(ctx: ProviderContext): Promise<boolean> {
    const opts = this.resolveOptions(ctx);
    const client = this.getClient(opts);
    const secretId = toSecretId(ctx.keyshelfName, ctx.envName, ctx.keyPath);

    try {
      await client.send(new DescribeSecretCommand({ SecretId: secretId }));
      return true;
    } catch (err) {
      if (isAuthError(err)) throw new AwsAuthError(err as Error);
      if (isRegionMissingError(err)) throw new AwsRegionError(ctx.keyPath, err as Error);
      if (err instanceof ResourceNotFoundException) return false;
      return false;
    }
  }

  async set(ctx: ProviderContext, value: string): Promise<void> {
    const opts = this.resolveOptions(ctx);
    const client = this.getClient(opts);
    const secretId = toSecretId(ctx.keyshelfName, ctx.envName, ctx.keyPath);
    await this.writeSecret(client, opts, ctx.keyPath, secretId, value);
  }

  async copy(from: ProviderContext, to: ProviderContext): Promise<void> {
    const opts = this.resolveOptions(from);
    const client = this.getClient(opts);
    const fromId = toSecretId(from.keyshelfName, from.envName, from.keyPath);
    const toId = toSecretId(to.keyshelfName, to.envName, to.keyPath);

    const result = await this.send(opts, from.keyPath, () =>
      client.send(new GetSecretValueCommand({ SecretId: fromId }))
    );

    let payload: string;
    if (typeof result.SecretString === "string" && result.SecretString.length > 0) {
      payload = result.SecretString;
    } else if (result.SecretBinary && result.SecretBinary.byteLength > 0) {
      payload = Buffer.from(result.SecretBinary).toString("utf-8");
    } else {
      throw new Error(`aws: source secret "${fromId}" has no payload`);
    }

    await this.writeSecret(client, opts, to.keyPath, toId, payload);
  }

  async delete(ctx: ProviderContext): Promise<void> {
    const opts = this.resolveOptions(ctx);
    const client = this.getClient(opts);
    const secretId = toSecretId(ctx.keyshelfName, ctx.envName, ctx.keyPath);

    try {
      await client.send(
        new DeleteSecretCommand({ SecretId: secretId, ForceDeleteWithoutRecovery: true })
      );
    } catch (err) {
      if (isAuthError(err)) throw new AwsAuthError(err as Error);
      if (isRegionMissingError(err)) throw new AwsRegionError(ctx.keyPath, err as Error);
      if (err instanceof ResourceNotFoundException) return;
      throw err;
    }
  }

  async list(ctx: ProviderListContext): Promise<StoredKey[]> {
    const opts = this.resolveOptions(ctx);
    const client = this.getClient(opts);
    const prefix = ctx.keyshelfName ? `keyshelf/${ctx.keyshelfName}/` : "keyshelf/";
    const envs = new Set(ctx.envs ?? []);

    const stored: StoredKey[] = [];
    let nextToken: string | undefined;
    do {
      const result = await this.send(opts, "<list>", () =>
        client.send(
          new ListSecretsCommand({
            Filters: [{ Key: "name", Values: [prefix] }],
            NextToken: nextToken
          })
        )
      );
      for (const secret of result.SecretList ?? []) {
        const parsed = parseSecretId(secret.Name, prefix, envs);
        if (parsed) stored.push(parsed);
      }
      nextToken = result.NextToken;
    } while (nextToken);

    return stored;
  }

  private async writeSecret(
    client: SecretsManagerClient,
    opts: AwsSmProviderOptions,
    keyPath: string,
    secretId: string,
    value: string
  ): Promise<void> {
    try {
      await client.send(
        new CreateSecretCommand({
          Name: secretId,
          SecretString: value,
          ...(opts.kmsKeyId ? { KmsKeyId: opts.kmsKeyId } : {})
        })
      );
      return;
    } catch (err) {
      if (isAuthError(err)) throw new AwsAuthError(err as Error);
      if (isRegionMissingError(err)) throw new AwsRegionError(keyPath, err as Error);
      if (!(err instanceof ResourceExistsException)) throw err;
    }

    await this.send(opts, keyPath, () =>
      client.send(new PutSecretValueCommand({ SecretId: secretId, SecretString: value }))
    );
  }
}

function parseSecretId(
  secretName: string | null | undefined,
  prefix: string,
  envs: Set<string>
): StoredKey | null {
  if (!secretName?.startsWith(prefix)) return null;
  const remainder = secretName.slice(prefix.length);
  if (remainder.length === 0) return null;
  return parseStoredSecretSegments(remainder.split("/"), envs);
}
