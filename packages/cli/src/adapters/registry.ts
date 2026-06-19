import path from 'node:path'
import {KeyshelfError} from '../errors.js'
import type {Provider} from '../model.js'
import type {Adapter} from './adapter.js'
import {FakeAdapter, fileStore} from './fake.js'
import {GcpAdapter} from './gcp.js'
import {SopsAdapter} from './sops.js'

/**
 * Everything an adapter needs to bind to a concrete environment's store. The
 * reference-adapter convention composes a remote secret's name from
 * `{project}-{shelf}-{env}-{key}` (docs/reference.md), so the project, shelf, and
 * environment names are part of the construction context, not just the provider
 * config.
 */
export interface AdapterContext {
  /** The project root directory (where `.keyshelf/` lives). */
  projectDir: string
  /** The project name from `config.yaml` (namespaces secrets). */
  project: string
  /** The shelf of the environment being resolved. */
  shelf: string
  /** The environment name being resolved. */
  env: string
}

/** Where the file-backed fake store lives, relative to the project root. */
const FAKE_STORE_FILE = path.join('.keyshelf', '.fake-store.json')

/**
 * Read a required string field from a provider's config, or fail with a
 * `MALFORMED_FILE` naming the config file and the missing field. Adapter config
 * shape is enforced here, at construction, rather than in the (pure, adapter-
 * agnostic) validator.
 */
function requireStringField(provider: Provider, field: string, ctx: AdapterContext): string {
  const value = provider[field]
  if (typeof value === 'string' && value.length > 0) return value
  throw new KeyshelfError(
    'MALFORMED_FILE',
    `Provider with adapter '${provider.adapter}' is missing required field '${field}'.`,
    {file: path.join(ctx.projectDir, '.keyshelf', 'config.yaml'), reason: `missing '${field}'`},
  )
}

/**
 * The sops store's default layout: a per-environment sibling encrypted file
 * `.keyshelf/{shelf}/{env}.secrets.yaml` (docs/reference.md, ADR-0002). A
 * provider may override the layout with a `store:` template using `{shelf}` and
 * `{env}` placeholders, resolved relative to the project root.
 */
function sopsStorePath(provider: Provider, ctx: AdapterContext): string {
  const template =
    typeof provider.store === 'string' ? provider.store : path.join('.keyshelf', '{shelf}', '{env}.secrets.yaml')
  const rel = template.replaceAll('{shelf}', ctx.shelf).replaceAll('{env}', ctx.env)
  return path.resolve(ctx.projectDir, rel)
}

/**
 * Construct the {@link Adapter} for a provider. The provider's `adapter`
 * discriminator selects the implementation; an unknown name is a structured
 * `ADAPTER_UNAVAILABLE` (the backend prerequisite — a known adapter — is
 * missing). New adapters (`sops`, `gcp`) slot in by adding a branch here without
 * reshaping the interface or its callers.
 */
export function createAdapter(provider: Provider, ctx: AdapterContext): Adapter {
  switch (provider.adapter) {
    case 'fake': {
      // Persist to a JSON file under the project so a value written in one
      // `keyshelf` process is resolvable by a separate process later (the E2E
      // suite spawns the real binary across invocations). The namespace mirrors
      // the reference convention `{project}-{shelf}-{env}` so the same key in
      // different environments stays distinct in the shared store.
      const storePath =
        typeof provider.store === 'string'
          ? path.resolve(ctx.projectDir, provider.store)
          : path.join(ctx.projectDir, FAKE_STORE_FILE)
      const namespace = `${ctx.project}-${ctx.shelf}-${ctx.env}`
      return new FakeAdapter(fileStore(storePath), namespace)
    }

    case 'sops': {
      // The store is a per-environment encrypted sibling file; recipients come
      // from the project's `.sops.yaml`, which sops discovers by walking up from
      // the store path — so the adapter runs sops with the project root as cwd.
      return new SopsAdapter({storePath: sopsStorePath(provider, ctx), cwd: ctx.projectDir})
    }

    case 'gcp': {
      // One secret per key in the provider's GCP project, named by the reference
      // convention `{project}-{shelf}-{env}-{key}`; the namespace is the
      // `{project}-{shelf}-{env}` prefix so the same key across environments
      // stays distinct in the shared backend. `location` is an optional
      // replication hint (absent/`global` ⇒ automatic).
      const projectId = requireStringField(provider, 'projectId', ctx)
      const location = typeof provider.location === 'string' ? provider.location : undefined
      const namespace = `${ctx.project}-${ctx.shelf}-${ctx.env}`
      return new GcpAdapter({projectId, namespace, location})
    }

    default: {
      throw new KeyshelfError(
        'ADAPTER_UNAVAILABLE',
        `Unknown adapter '${provider.adapter}'. No adapter is registered for it.`,
        {adapter: provider.adapter},
      )
    }
  }
}
