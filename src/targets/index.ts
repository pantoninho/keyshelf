import { TargetConfig } from '../core/types.js';
import { DeployTarget } from './target.js';
import { EasTarget } from './eas.js';

/**
 * Create a DeployTarget from adapter configuration.
 *
 * @param config - Target adapter configuration
 * @returns A DeployTarget instance for the specified adapter
 */
export function createTarget(config: TargetConfig): DeployTarget {
    switch (config.adapter) {
        case 'eas':
            return new EasTarget(config.environment);
        default:
            throw new Error(`Unknown target adapter: "${(config as { adapter: string }).adapter}"`);
    }
}
