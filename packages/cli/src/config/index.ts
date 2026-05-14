export { defineConfig, config, secret, age, aws, gcp, sops, plain } from "./factories.js";
export { findRootDir, loadConfig, type LoadedConfig, type LoadConfigOptions } from "./loader.js";
export {
  isProviderRef,
  keyshelfConfigSchema,
  normalizeConfig,
  providerRefSchema,
  validateAppMappingReferences
} from "./schema.js";
export type {
  AgeProviderOptions,
  AwsProviderOptions,
  BuiltinProviderRef,
  ConfigBinding,
  ConfigRecord,
  ConfigRecordInput,
  ConfigScalar,
  DefineConfigInput,
  GcpProviderOptions,
  KeyPaths,
  KeyshelfConfig,
  KeyTree,
  NormalizedConfig,
  NormalizedRecord,
  PlainProviderOptions,
  ProviderRef,
  SecretRecord,
  SecretRecordInput,
  SopsProviderOptions
} from "./types.js";
