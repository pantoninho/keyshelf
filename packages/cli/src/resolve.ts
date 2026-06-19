import type {Adapter} from './adapters/adapter.js'
import {KeyshelfError} from './errors.js'
import type {LoadedEnvironment} from './model.js'

/** The canonical env-var identifier rule (docs/reference.md). */
const KEY_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/

/**
 * Resolve a structurally-valid environment into the flat `string→string` map of
 * env-var names → values that Keyshelf manages.
 *
 * Merge order (docs/reference.md "run resolution & precedence", steps 1–2):
 * 1. A schema `config` key contributes its default unless the environment
 *    overrides it; an environment plaintext value wins. `!required`/`!optional`
 *    keys with no default and no environment value contribute nothing.
 * 2. Every `!secret` resolves through the environment's provider's `adapter` —
 *    by convention on the key name, or via the explicit `{ ref: ... }` override.
 *
 * The adapter is supplied as a factory and is built **lazily**, only when the
 * environment actually declares a `!secret`. This keeps a config-only
 * environment resolvable without constructing (or even being able to construct)
 * its provider's adapter.
 *
 * Resolution is fail-fast: if any secret is unresolvable the adapter throws a
 * {@link KeyshelfError} (e.g. `SECRET_NOT_FOUND`) and no map is returned, so a
 * caller never launches a half-populated environment. The config-merge step is
 * pure; only secret resolution touches the backend (through the adapter seam).
 */
export async function resolveEnvironment(
  loaded: LoadedEnvironment,
  adapterFor: () => Adapter,
): Promise<Record<string, string>> {
  const {schema, environment} = loaded
  const map: Record<string, string> = {}

  // Schema config defaults form the base layer.
  for (const [key, declared] of Object.entries(schema.keys)) {
    if (declared.kind === 'config' && declared.default !== undefined) {
      map[key] = declared.default
    }
  }

  // Build the adapter once, on first secret only.
  let adapter: Adapter | undefined

  // Environment values overlay the defaults: plaintext wins directly; a !secret
  // resolves through the provider's adapter (convention, or explicit ref).
  for (const [key, value] of Object.entries(environment.keys)) {
    if (value.kind === 'secret') {
      adapter ??= adapterFor()
      // eslint-disable-next-line no-await-in-loop
      map[key] = await resolveSecret(adapter, key, value.ref)
    } else {
      map[key] = value.value ?? ''
    }
  }

  return map
}

/** Resolve one secret through the adapter, normalising non-Keyshelf throws. */
async function resolveSecret(adapter: Adapter, key: string, ref: unknown): Promise<string> {
  try {
    return await adapter.resolve(key, ref)
  } catch (error) {
    if (error instanceof KeyshelfError) throw error
    throw new KeyshelfError('ADAPTER_ERROR', `Failed to resolve secret '${key}': ${String(error)}`, {key})
  }
}

/** A parsed `--set KEY=VALUE` flag. */
export interface SetAssignment {
  key: string
  value: string
}

/** Parse a single `--set KEY=VALUE` token, splitting on the first `=` only. */
export function parseSet(assignment: string): SetAssignment {
  const eq = assignment.indexOf('=')
  if (eq === -1) {
    throw new KeyshelfError(
      'MALFORMED_FILE',
      `--set expects KEY=VALUE; got '${assignment}'.`,
      {reason: 'expected KEY=VALUE', value: assignment},
    )
  }

  const key = assignment.slice(0, eq)
  if (!KEY_NAME_PATTERN.test(key)) {
    throw new KeyshelfError(
      'INVALID_KEY_NAME',
      `--set key '${key}' is not a valid env-var identifier (expected ${KEY_NAME_PATTERN}).`,
      {key},
    )
  }

  return {key, value: assignment.slice(eq + 1)}
}

/**
 * Build the child process environment by applying precedence (lowest → highest):
 * inherited ambient env → Keyshelf's resolved managed values → explicit `--set`.
 *
 * The inherited ambient value survives only for keys Keyshelf does not manage; a
 * stale ambient var of a managed key is overridden by the resolved value.
 */
export function buildChildEnv(input: {
  ambient: Record<string, string | undefined>
  managed: Record<string, string>
  sets: Record<string, string>
}): Record<string, string> {
  const out: Record<string, string> = {}

  for (const [key, value] of Object.entries(input.ambient)) {
    if (value !== undefined) out[key] = value
  }

  Object.assign(out, input.managed, input.sets)
  return out
}
