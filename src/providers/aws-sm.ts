import {
    SecretsManagerClient,
    GetSecretValueCommand,
    PutSecretValueCommand,
    CreateSecretCommand,
    DeleteSecretCommand,
    ListSecretsCommand
} from '@aws-sdk/client-secrets-manager';
import { fromIni } from '@aws-sdk/credential-providers';
import { SecretProvider } from './provider.js';

type AwsSmConfig = {
    name: string;
    profile?: string;
};

/** Stores secrets in AWS Secrets Manager using configurable credentials. */
export class AwsSmProvider implements SecretProvider {
    private readonly client: SecretsManagerClient;
    private readonly name: string;

    constructor(config: AwsSmConfig) {
        if (config.name.includes('/')) {
            throw new Error(`project name must not contain "/": got "${config.name}"`);
        }
        this.name = config.name;
        const credentials = config.profile ? fromIni({ profile: config.profile }) : undefined;
        this.client = new SecretsManagerClient(credentials ? { credentials } : {});
    }

    ref(env: string, secretPath: string): string {
        return buildSecretName(this.name, env, secretPath);
    }

    async get(env: string, secretPath: string): Promise<string> {
        try {
            const response = await this.client.send(
                new GetSecretValueCommand({ SecretId: buildSecretName(this.name, env, secretPath) })
            );
            if (response.SecretString === undefined) {
                throw new Error(
                    `Secret "${secretPath}" in environment "${env}" is a binary secret, which is not supported.`
                );
            }
            return response.SecretString;
        } catch (err: unknown) {
            if (isNotFoundError(err)) {
                throw new Error(`Secret "${secretPath}" not found in environment "${env}"`);
            }
            throw err;
        }
    }

    async set(env: string, secretPath: string, value: string): Promise<void> {
        const secretId = buildSecretName(this.name, env, secretPath);

        try {
            await this.client.send(
                new PutSecretValueCommand({ SecretId: secretId, SecretString: value })
            );
        } catch (err: unknown) {
            if (!isNotFoundError(err)) throw err;
            await this.client.send(
                new CreateSecretCommand({ Name: secretId, SecretString: value })
            );
        }
    }

    async delete(env: string, secretPath: string): Promise<void> {
        try {
            await this.client.send(
                new DeleteSecretCommand({
                    SecretId: buildSecretName(this.name, env, secretPath),
                    ForceDeleteWithoutRecovery: true
                })
            );
        } catch (err: unknown) {
            if (isNotFoundError(err)) {
                throw new Error(`Secret "${secretPath}" not found in environment "${env}"`);
            }
            throw err;
        }
    }

    async list(env: string, prefix?: string): Promise<string[]> {
        const envPrefix = `keyshelf/${this.name}/${env}/`;
        const paths: string[] = [];
        let nextToken: string | undefined;

        do {
            const response = await this.client.send(
                new ListSecretsCommand({
                    Filters: [{ Key: 'name', Values: [envPrefix] }],
                    NextToken: nextToken
                })
            );

            for (const secret of response.SecretList ?? []) {
                if (!secret.Name?.startsWith(envPrefix)) continue;
                const secretPath = secret.Name.slice(envPrefix.length);
                if (!secretPath) continue;
                if (!prefix || secretPath === prefix || secretPath.startsWith(prefix + '/')) {
                    paths.push(secretPath);
                }
            }

            nextToken = response.NextToken;
        } while (nextToken);

        return paths;
    }
}

/**
 * Build the AWS Secrets Manager secret name for a given env and path.
 * @param name - Project name (must not contain `/`)
 * @param env - Environment name (must not contain `/`)
 * @param secretPath - `/`-delimited path to the secret
 * @returns The full secret name: `keyshelf/<name>/<env>/<secretPath>`
 */
export function buildSecretName(name: string, env: string, secretPath: string): string {
    if (name.includes('/')) {
        throw new Error(`name must not contain "/": got "${name}"`);
    }
    if (env.includes('/')) {
        throw new Error(`env must not contain "/": got "${env}"`);
    }
    return `keyshelf/${name}/${env}/${secretPath}`;
}

function isNotFoundError(err: unknown): boolean {
    return (
        typeof err === 'object' &&
        err !== null &&
        'name' in err &&
        (err as { name: string }).name === 'ResourceNotFoundException'
    );
}
