export {
  parseSchema,
  type KeyDefinition,
  type ParsedSchema,
  type SchemaConfig,
} from './config/schema.js';
export {
  parseEnvironment,
  parseProviderBlock,
  type EnvConfig,
  type ProviderConfig,
} from './config/environment.js';
export { parseAppMapping, type AppMapping } from './config/app-mapping.js';
export { loadConfig, findRootDir, type LoadedConfig } from './config/loader.js';
export {
  KEYSHELF_SCHEMA,
  isTaggedValue,
  type TaggedValue,
} from './config/yaml-tags.js';

export { resolve, validate, type ResolveOptions } from './resolver/index.js';
export type { ResolvedKey, ValidationError } from './resolver/types.js';

export type { Provider, ProviderContext } from './providers/types.js';
export { ProviderRegistry } from './providers/registry.js';
export { PlaintextProvider } from './providers/plaintext.js';
export {
  AgeProvider,
  generateIdentity,
  identityToRecipient,
} from './providers/age.js';
export {
  GcpSmProvider,
  type GcpSmProviderOptions,
} from './providers/gcp-sm.js';
export { createDefaultRegistry } from './providers/setup.js';

export { flattenKeys, setNestedValue } from './utils/paths.js';

export { createProgram } from './cli/index.js';
