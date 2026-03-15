import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { SecretProvider } from './provider.js';

const MAX_SECRET_ID_LENGTH = 255;

/** Stores secrets in GCP Secret Manager using ADC for authentication. */
export class GcpSmProvider implements SecretProvider {
    private readonly client: SecretManagerServiceClient;
    private readonly project: string;
    private readonly name: string;

    constructor(name: string, project: string) {
        this.name = name;
        this.project = project;
        this.client = new SecretManagerServiceClient();
    }

    ref(env: string, secretPath: string): string {
        return buildSecretId(this.name, env, secretPath);
    }

    async get(env: string, secretPath: string): Promise<string> {
        const secretId = buildSecretId(this.name, env, secretPath);
        const name = `projects/${this.project}/secrets/${secretId}/versions/latest`;

        try {
            const [version] = await this.client.accessSecretVersion({ name });
            return version.payload?.data?.toString() ?? '';
        } catch (err: unknown) {
            if (isNotFoundError(err)) {
                throw new Error(`Secret "${secretPath}" not found in environment "${env}"`);
            }
            throw err;
        }
    }

    async set(env: string, secretPath: string, value: string): Promise<void> {
        const secretId = buildSecretId(this.name, env, secretPath);
        const parent = `projects/${this.project}`;
        const secretName = `${parent}/secrets/${secretId}`;

        try {
            await this.client.getSecret({ name: secretName });
        } catch (err: unknown) {
            if (isNotFoundError(err)) {
                await this.client.createSecret({
                    parent,
                    secretId,
                    secret: { replication: { automatic: {} } }
                });
            } else {
                throw err;
            }
        }

        await this.client.addSecretVersion({
            parent: secretName,
            payload: { data: Buffer.from(value, 'utf-8') }
        });
    }

    async delete(env: string, secretPath: string): Promise<void> {
        const secretId = buildSecretId(this.name, env, secretPath);
        const name = `projects/${this.project}/secrets/${secretId}`;

        try {
            await this.client.deleteSecret({ name });
        } catch (err: unknown) {
            if (isNotFoundError(err)) {
                throw new Error(`Secret "${secretPath}" not found in environment "${env}"`);
            }
            throw err;
        }
    }

    async list(env: string, prefix?: string): Promise<string[]> {
        const parent = `projects/${this.project}`;
        const envPrefix = `${this.name}__${env}__`;
        const paths: string[] = [];

        const [secrets] = await this.client.listSecrets({ parent });
        for (const secret of secrets) {
            const id = secret.name?.split('/').pop();
            if (!id || !id.startsWith(envPrefix)) continue;

            const secretPath = id.slice(envPrefix.length).replaceAll('__', '/');
            if (!prefix || secretPath === prefix || secretPath.startsWith(prefix + '/')) {
                paths.push(secretPath);
            }
        }

        return paths;
    }
}

/** Encode project name, env and path into a GCP-safe secret ID. */
export function buildSecretId(name: string, env: string, secretPath: string): string {
    const id = `${name}__${env}__${secretPath.replaceAll('/', '__')}`;
    if (id.length > MAX_SECRET_ID_LENGTH) {
        throw new Error(
            `Secret ID exceeds GCP's ${MAX_SECRET_ID_LENGTH}-character limit: "${id}" (${id.length} chars).`
        );
    }
    return id;
}

function isNotFoundError(err: unknown): boolean {
    return (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: number }).code === 5
    );
}
