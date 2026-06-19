/**
 * The in-memory model of a loaded Keyshelf project. Identity is
 * filesystem-derived (see docs/reference.md): a shelf is its directory name, an
 * environment is its filename, and a schema is its shelf's `schema.yaml`. None of
 * these names is stored as a field in the files.
 *
 * The loader (`src/loader.ts`) reads the YAML files off disk into these shapes;
 * the validator (`src/validate.ts`) is pure logic over them with no I/O.
 */

/** The kind of presence requirement a schema declares for a key. */
export type SchemaKeyKind = 'config' | 'required' | 'optional'

/** One declared key in a shelf's schema — presence only, never representation. */
export interface SchemaKey {
  kind: SchemaKeyKind
  /** The default value, present only for `kind === 'config'`. */
  default?: string
}

/** A shelf's closed validation contract, parsed from `schema.yaml`. */
export interface Schema {
  keys: Record<string, SchemaKey>
}

/** How a key's value is represented in an environment file. */
export type ValueKind = 'config' | 'secret'

/** One key/value entry in an environment file. */
export interface EnvironmentValue {
  kind: ValueKind
  /** Plaintext value, present only for `kind === 'config'`. */
  value?: string
  /** Adapter-defined `!secret` reference payload, when explicitly given. */
  ref?: unknown
}

/** An environment, parsed from `{shelf}/{env}.yaml`. */
export interface Environment {
  /** The shelf this environment belongs to (its directory name). */
  shelf: string
  /** The environment name (its filename without extension). */
  name: string
  /** The provider name this environment references in `config.yaml`. */
  provider: string
  keys: Record<string, EnvironmentValue>
}

/** A configured provider (an adapter plus its config) from `config.yaml`. */
export interface Provider {
  adapter: string
  [field: string]: unknown
}

/** The project-global `config.yaml`. */
export interface Config {
  project: string
  providers: Record<string, Provider>
}

/** Everything needed to validate a single environment, assembled by the loader. */
export interface LoadedEnvironment {
  config: Config
  schema: Schema
  environment: Environment
}
