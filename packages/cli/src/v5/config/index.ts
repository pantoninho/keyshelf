export { defineConfig, config, secret, age, gcp, sops } from "./factories.js";
export {
  findV5RootDir,
  loadV5Config,
  type LoadedV5Config,
  type LoadV5ConfigOptions
} from "./loader.js";
export {
  isProviderRef,
  keyshelfConfigSchema,
  normalizeConfig,
  providerRefSchema,
  validateAppMappingReferences
} from "./schema.js";
export type {
  AgeProviderOptions,
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
  ProviderRef,
  SecretRecord,
  SecretRecordInput,
  SopsProviderOptions
} from "./types.js";
