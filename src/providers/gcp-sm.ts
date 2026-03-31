import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import type { Provider, ProviderContext } from "./types.js";

export interface GcpSmProviderOptions {
  project: string;
}

function toSecretId(envName: string, keyPath: string): string {
  return `keyshelf__${envName}__${keyPath.replace(/\//g, "__")}`;
}

export class GcpSmProvider implements Provider {
  name = "gcp";

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
    const secretId = toSecretId(ctx.envName, ctx.keyPath);

    const [version] = await this.client.accessSecretVersion({
      name: `projects/${opts.project}/secrets/${secretId}/versions/latest`
    });

    const payload = version.payload?.data;
    if (!payload) {
      throw new Error(`Secret "${secretId}" in project "${opts.project}" has no payload`);
    }

    return typeof payload === "string" ? payload : Buffer.from(payload).toString("utf-8");
  }

  async validate(ctx: ProviderContext): Promise<boolean> {
    try {
      const opts = this.resolveOptions(ctx);
      const secretId = toSecretId(ctx.envName, ctx.keyPath);

      await this.client.getSecret({
        name: `projects/${opts.project}/secrets/${secretId}`
      });
      return true;
    } catch {
      return false;
    }
  }

  async set(ctx: ProviderContext, value: string): Promise<void> {
    const opts = this.resolveOptions(ctx);
    const secretId = toSecretId(ctx.envName, ctx.keyPath);
    const parent = `projects/${opts.project}`;

    // Create secret if it doesn't exist
    try {
      await this.client.createSecret({
        parent,
        secretId,
        secret: { replication: { automatic: {} } }
      });
    } catch (err: unknown) {
      const code = (err as { code?: number }).code;
      if (code !== 6) {
        // 6 = ALREADY_EXISTS
        throw err;
      }
    }

    // Add new version
    await this.client.addSecretVersion({
      parent: `${parent}/secrets/${secretId}`,
      payload: { data: Buffer.from(value, "utf-8") }
    });
  }

  async delete(ctx: ProviderContext): Promise<void> {
    const opts = this.resolveOptions(ctx);
    const secretId = toSecretId(ctx.envName, ctx.keyPath);
    await this.client.deleteSecret({
      name: `projects/${opts.project}/secrets/${secretId}`
    });
  }
}
