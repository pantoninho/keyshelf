import { execSync } from "node:child_process";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import type { Provider, ProviderContext } from "@/types";

/** Resolve the GCP project from env var or gcloud CLI */
export function getGcpProject(): string {
  if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT;

  try {
    const project = execSync("gcloud config get-value project", { encoding: "utf-8" }).trim();
    if (project && project !== "(unset)") return project;
  } catch {
    // gcloud not installed or failed — fall through to error
  }

  throw new Error(
    "GCP project not found. Set GOOGLE_CLOUD_PROJECT env var or run 'gcloud config set project <project>'."
  );
}

/** Derive a secret ID from provider context — slashes in keyPath become __ */
export function buildSecretId(context: ProviderContext): string {
  const sanitizedKeyPath = context.keyPath.replace(/\//g, "__");
  return `${context.projectName}__${context.env}__${sanitizedKeyPath}`;
}

async function getSecret(reference: string): Promise<string> {
  const client = new SecretManagerServiceClient();
  const [version] = await client.accessSecretVersion({ name: `${reference}/versions/latest` });

  const payload = version.payload?.data?.toString();
  if (!payload) {
    throw new Error(
      `Secret '${reference}' has an empty payload. Ensure the secret version contains a value.`
    );
  }

  return payload;
}

async function upsertSecret(secretId: string, value: string, gcpProject: string): Promise<string> {
  const client = new SecretManagerServiceClient();
  const parent = `projects/${gcpProject}`;
  const name = `${parent}/secrets/${secretId}`;

  try {
    await client.createSecret({ parent, secretId, secret: { replication: { automatic: {} } } });
  } catch (err: unknown) {
    const code = (err as { code?: number }).code;
    if (code !== 6) throw err;
  }

  await client.addSecretVersion({ parent: name, payload: { data: Buffer.from(value) } });
  return name;
}

/** GCP Secret Manager provider */
export const gcpSmProvider: Provider = {
  async get(reference: string, _context: ProviderContext): Promise<string> {
    return getSecret(reference);
  },

  async set(value: string, context: ProviderContext): Promise<string> {
    if (context.keyPath.includes("__")) {
      throw new Error(
        "Key paths must not contain '__' (double underscore) when using the gcsm provider."
      );
    }

    const secretId = buildSecretId(context);
    const gcpProject = getGcpProject();
    return upsertSecret(secretId, value, gcpProject);
  }
};
