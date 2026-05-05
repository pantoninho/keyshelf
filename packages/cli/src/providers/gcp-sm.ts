import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import type {
  Provider,
  ProviderContext,
  ProviderListContext,
  StorageScope,
  StoredKey
} from "./types.js";

export interface GcpSmProviderOptions {
  project: string;
}

export class GcpAuthError extends Error {
  constructor(cause?: Error) {
    super(
      "GCP authentication failed. Run `gcloud auth application-default login` to re-authenticate."
    );
    this.name = "GcpAuthError";
    this.cause = cause;
  }
}

const AUTH_ERROR_PATTERNS = [
  "invalid_grant",
  "invalid_rapt",
  "reauth related error",
  "token has been expired or revoked",
  "Could not load the default credentials",
  "Could not automatically determine credentials"
];

function isAuthError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  const code = (err as { code?: number }).code;
  // gRPC UNAUTHENTICATED = 16
  if (code === 16) return true;
  return AUTH_ERROR_PATTERNS.some((pattern) => msg.includes(pattern));
}

export function toSecretId(
  keyshelfName: string | undefined,
  envName: string | undefined,
  keyPath: string
): string {
  const path = keyPath.replace(/\//g, "__");
  const segments = ["keyshelf"];
  if (keyshelfName !== undefined) segments.push(keyshelfName);
  if (envName !== undefined && envName !== "") segments.push(envName);
  segments.push(path);
  return segments.join("__");
}

export class GcpSmProvider implements Provider {
  name = "gcp";
  storageScope: StorageScope = "perEnv";

  private client: SecretManagerServiceClient;

  constructor(client?: SecretManagerServiceClient) {
    this.client = client ?? new SecretManagerServiceClient();
  }

  private resolveOptions(ctx: ProviderContext): GcpSmProviderOptions {
    const project = ctx.config.project;

    if (typeof project !== "string") {
      throw new Error(`gcp provider requires "project" config for "${ctx.keyPath}"`);
    }

    return { project };
  }

  async resolve(ctx: ProviderContext): Promise<string> {
    const opts = this.resolveOptions(ctx);
    const secretId = toSecretId(ctx.keyshelfName, ctx.envName, ctx.keyPath);

    let version;
    try {
      [version] = await this.client.accessSecretVersion({
        name: `projects/${opts.project}/secrets/${secretId}/versions/latest`
      });
    } catch (err) {
      if (isAuthError(err)) throw new GcpAuthError(err as Error);
      throw err;
    }

    const payload = version.payload?.data;
    if (!payload) {
      throw new Error(`Secret "${secretId}" in project "${opts.project}" has no payload`);
    }

    return typeof payload === "string" ? payload : Buffer.from(payload).toString("utf-8");
  }

  async validate(ctx: ProviderContext): Promise<boolean> {
    try {
      const opts = this.resolveOptions(ctx);
      const secretId = toSecretId(ctx.keyshelfName, ctx.envName, ctx.keyPath);

      await this.client.getSecret({
        name: `projects/${opts.project}/secrets/${secretId}`
      });
      return true;
    } catch (err) {
      if (isAuthError(err)) throw new GcpAuthError(err as Error);
      return false;
    }
  }

  async set(ctx: ProviderContext, value: string): Promise<void> {
    const opts = this.resolveOptions(ctx);
    const secretId = toSecretId(ctx.keyshelfName, ctx.envName, ctx.keyPath);
    const parent = `projects/${opts.project}`;

    // Create secret if it doesn't exist
    try {
      await this.client.createSecret({
        parent,
        secretId,
        secret: { replication: { automatic: {} } }
      });
    } catch (err: unknown) {
      if (isAuthError(err)) throw new GcpAuthError(err as Error);
      const code = (err as { code?: number }).code;
      if (code !== 6) {
        // 6 = ALREADY_EXISTS
        throw err;
      }
    }

    // Add new version
    try {
      await this.client.addSecretVersion({
        parent: `${parent}/secrets/${secretId}`,
        payload: { data: Buffer.from(value, "utf-8") }
      });
    } catch (err) {
      if (isAuthError(err)) throw new GcpAuthError(err as Error);
      throw err;
    }
  }

  async list(ctx: ProviderListContext): Promise<StoredKey[]> {
    const project = ctx.config.project;
    if (typeof project !== "string") {
      throw new Error('gcp provider requires "project" config for list');
    }

    const prefix = ctx.keyshelfName ? `keyshelf__${ctx.keyshelfName}__` : "keyshelf__";
    const envs = new Set(ctx.envs ?? []);

    const secrets = await this.callListSecrets(project);
    return secrets.flatMap((secret) => parseSecretId(secret.name, prefix, envs) ?? []);
  }

  private async callListSecrets(project: string) {
    try {
      const [secrets] = await this.client.listSecrets({ parent: `projects/${project}` });
      return secrets;
    } catch (err) {
      if (isAuthError(err)) throw new GcpAuthError(err as Error);
      throw err;
    }
  }
}

function parseSecretId(
  secretName: string | null | undefined,
  prefix: string,
  envs: Set<string>
): StoredKey | null {
  const id = secretName?.split("/").pop();
  if (!id?.startsWith(prefix)) return null;

  const remainder = id.slice(prefix.length);
  if (remainder.length === 0) return null;

  const segs = remainder.split("__");
  const envName = envs.has(segs[0]) ? segs[0] : undefined;
  const pathSegs = envName === undefined ? segs : segs.slice(1);
  if (pathSegs.length === 0) return null;

  return { keyPath: pathSegs.join("/"), envName };
}
