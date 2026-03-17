import { ProviderConfig } from '../../src/core/types.js';
import { SecretProvider } from '../../src/providers/provider.js';
import { createProvider } from '../../src/providers/index.js';

type Adapter = ProviderConfig['adapter'];

function getProviderConfig(): ProviderConfig {
    const adapter = (process.env.KEYSHELF_E2E_PROVIDER ?? 'aws-sm') as Adapter;
    switch (adapter) {
        case 'aws-sm':
            return { adapter: 'aws-sm' };
        case 'gcp-sm': {
            const project = process.env.KEYSHELF_E2E_GCP_PROJECT;
            if (!project) {
                throw new Error('KEYSHELF_E2E_GCP_PROJECT is required when using gcp-sm provider');
            }
            return { adapter: 'gcp-sm', project };
        }
        default:
            throw new Error(`Unsupported e2e provider: ${adapter}`);
    }
}

export const providerConfig = getProviderConfig();

export const providerLabel = providerConfig.adapter;

export function createTestProvider(projectName: string): SecretProvider {
    return createProvider(providerConfig, '', projectName);
}
