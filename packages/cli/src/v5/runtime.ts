// Public runtime surface for embedders (e.g. the keyshelf GitHub Action).
// Stable contract for code that loads, resolves, and renders v5 configs at
// runtime. `keyshelf/config` is for *user-authored* configs; this entry is
// for *tooling that consumes them*.

export {
  findV5RootDir,
  loadV5Config,
  type LoadedV5Config,
  type LoadV5ConfigOptions
} from "./config/loader.js";

export {
  formatSkipCause,
  renderAppMapping,
  resolveWithStatus,
  validate,
  type ResolveV5Options
} from "./resolver/index.js";

export type {
  RenderedV5EnvVar,
  ResolvedV5Key,
  V5KeyResolutionStatus,
  V5Resolution,
  V5SkipCause,
  V5TopLevelError,
  V5ValidationError,
  V5ValidationResult
} from "./resolver/types.js";

export type { NormalizedConfig, NormalizedRecord } from "./config/types.js";

export { isTemplateMapping, type AppMapping } from "../config/app-mapping.js";

export { ProviderRegistry } from "../providers/registry.js";
export { PlaintextProvider } from "../providers/plaintext.js";
export { AgeProvider, generateIdentity, identityToRecipient } from "../providers/age.js";
export { SopsProvider } from "../providers/sops.js";
export type { Provider, ProviderContext } from "../providers/types.js";
