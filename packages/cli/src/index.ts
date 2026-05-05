// Public runtime surface for embedders (e.g. the keyshelf GitHub Action).
// Stable contract for code that loads, resolves, and renders configs at
// runtime. `keyshelf/config` is for *user-authored* configs; this entry is
// for *tooling that consumes them*.

export {
  findRootDir,
  loadConfig,
  type LoadedConfig,
  type LoadConfigOptions
} from "./config/loader.js";

export {
  formatSkipCause,
  renderAppMapping,
  resolveWithStatus,
  validate,
  type ResolveOptions
} from "./resolver/index.js";

export type {
  RenderedEnvVar,
  ResolvedKey,
  KeyResolutionStatus,
  Resolution,
  SkipCause,
  TopLevelError,
  ValidationError,
  ValidationResult
} from "./resolver/types.js";

export type { NormalizedConfig, NormalizedRecord } from "./config/types.js";

export { isTemplateMapping, type AppMapping } from "./config/app-mapping.js";

export { ProviderRegistry } from "./providers/registry.js";
export { PlaintextProvider } from "./providers/plaintext.js";
export { AgeProvider, generateIdentity, identityToRecipient } from "./providers/age.js";
export { SopsProvider } from "./providers/sops.js";
export type { Provider, ProviderContext } from "./providers/types.js";

export { createProgram } from "./cli/index.js";
