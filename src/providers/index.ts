import { ProviderConfig } from '../core/types.js';
import { SecretProvider } from './provider.js';
import { LocalProvider } from './local.js';
import { GcpSmProvider } from './gcp-sm.js';

/** Create a SecretProvider from adapter configuration. */
export function createProvider(config: ProviderConfig, configDir: string): SecretProvider {
    switch (config.adapter) {
        case 'local':
            return new LocalProvider(configDir);
        case 'gcp-sm':
            return new GcpSmProvider(config.project);
    }
}
