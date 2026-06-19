import {SecretManagerServiceClient} from '@google-cloud/secret-manager'
import {KeyshelfError} from '../errors.js'
import type {Adapter} from './adapter.js'

/**
 * The gcp adapter (ADR-0002, ADR-0006). It stores each key as its own Google
 * Cloud Secret Manager *secret* and writes a new *version* per `write`; `resolve`
 * reads the `latest` version. Authentication is Application Default Credentials —
 * the SDK discovers them from `GOOGLE_APPLICATION_CREDENTIALS`, `gcloud` ADC, or
 * the metadata server — so Keyshelf owns no credentials of its own.
 *
 * **Store.** One secret per key in the configured `projectId`, named by the fixed
 * reference convention `{project}-{shelf}-{env}-{key}` (docs/reference.md). The
 * `{project}-{shelf}-{env}` prefix is the adapter's `namespace`, so the same key
 * in two environments stays distinct in the shared backend. `location` selects
 * the replication policy: absent or `global` ⇒ automatic replication; any other
 * value ⇒ user-managed replication pinned to that single region.
 *
 * **Value encoding.** Secret Manager payloads are raw bytes but reject an *empty*
 * payload, and the contract demands an empty string round-trip byte-exactly. So,
 * exactly as the sops adapter does, every value is carried as a JSON string:
 * `write` stores `JSON.stringify(value)` and `resolve` `JSON.parse`s it back. An
 * empty string becomes the two-byte `""`, and the write→resolve round-trip stays
 * byte-exact for adversarial values (newlines, whitespace, quotes, unicode,
 * multi-KB blobs).
 *
 * **Reference.** Convention resolution is by key name: `write(key, value)` stores
 * under the composed secret id and returns that id, which equals the convention
 * `set` resolves by — so a matching `set` records a bare `!secret`. An explicit
 * `!secret { ref: NAME }` resolves a differently-named secret; a `NAME` that is a
 * full `projects/.../secrets/...` resource path resolves a foreign secret (any
 * project), otherwise it is a bare secret id in the configured `projectId`.
 *
 * **Error mapping** (uniform across adapters, ADR-0005):
 * - secret/version absent → `SECRET_NOT_FOUND`;
 * - credential/permission failure → `PROVIDER_AUTH`;
 * - any other backend/IO failure → `ADAPTER_ERROR`.
 */

/** gRPC status codes the adapter maps on (google.rpc.Code). */
const GRPC = {
  NOT_FOUND: 5,
  ALREADY_EXISTS: 6,
  PERMISSION_DENIED: 7,
  UNAUTHENTICATED: 16,
} as const

/**
 * The slice of `SecretManagerServiceClient` the adapter depends on. Narrowing to
 * these three calls keeps the adapter unit-testable with an in-memory double —
 * the gcp conformance suite is gated on real infrastructure (ADR-0005), so the
 * hermetic per-PR coverage of the adapter's own logic rides on this seam.
 */
export interface SecretsClient {
  accessSecretVersion(request: {name: string}): Promise<[AccessResponse, ...unknown[]]>
  createSecret(request: {
    parent: string
    secretId: string
    secret: {replication: ReplicationPolicy}
  }): Promise<[unknown, ...unknown[]]>
  addSecretVersion(request: {
    parent: string
    payload: {data: Buffer}
  }): Promise<[unknown, ...unknown[]]>
}

/** The fields of an accessSecretVersion response the adapter reads. */
interface AccessResponse {
  payload?: {data?: Uint8Array | string | null} | null
}

/** A Secret Manager replication policy: automatic, or pinned to one region. */
type ReplicationPolicy = {automatic: Record<string, never>} | {userManaged: {replicas: Array<{location: string}>}}

export class GcpAdapter implements Adapter {
  private readonly client: SecretsClient
  private readonly projectId: string
  private readonly namespace: string
  private readonly location?: string

  constructor(opts: {projectId: string; namespace: string; location?: string; client?: SecretsClient}) {
    this.projectId = opts.projectId
    this.namespace = opts.namespace
    this.location = opts.location
    this.client = opts.client ?? (new SecretManagerServiceClient() as unknown as SecretsClient)
  }

  /** Compose the convention secret id for a key: `{namespace}-{key}`. */
  private conventionName(key: string): string {
    return this.namespace === '' ? key : `${this.namespace}-${key}`
  }

  async resolve(key: string, ref?: unknown): Promise<string> {
    const name = ref === undefined ? this.conventionName(key) : refName(ref)
    const version = this.versionResource(name)
    let response: AccessResponse
    try {
      ;[response] = await this.client.accessSecretVersion({name: version})
    } catch (error) {
      throw mapGcpError(error, {key, ref: name})
    }

    const data = response.payload?.data
    if (data === undefined || data === null) {
      // A version with no payload should not happen for values we wrote, but a
      // foreign or hand-created secret could have one — treat it as absent.
      throw new KeyshelfError('SECRET_NOT_FOUND', `Secret '${name}' has no payload in its latest version.`, {
        key,
        ref: name,
      })
    }

    // Values were stored via JSON.stringify; recover the exact original. `data`
    // is bytes (a Buffer) for our writes, but the API may hand back a base64
    // string in some transports — Buffer.from handles both via the right coding.
    const json = typeof data === 'string' ? Buffer.from(data, 'base64').toString('utf8') : Buffer.from(data).toString('utf8')
    return decodeValue(json, name)
  }

  async write(key: string, value: string): Promise<unknown> {
    const name = this.conventionName(key)
    await this.ensureSecret(name)
    try {
      await this.client.addSecretVersion({
        parent: this.secretResource(name),
        payload: {data: Buffer.from(JSON.stringify(value), 'utf8')},
      })
    } catch (error) {
      throw mapGcpError(error, {key, ref: name})
    }

    // The value is stored under the convention secret id, which is exactly the
    // name `set` resolves by — returning it records a bare `!secret`, and a
    // foreign environment can reference it explicitly via `!secret { ref: name }`.
    return name
  }

  /** Create the secret container if it does not already exist (idempotent). */
  private async ensureSecret(name: string): Promise<void> {
    try {
      await this.client.createSecret({
        parent: `projects/${this.projectId}`,
        secretId: name,
        secret: {replication: this.replication()},
      })
    } catch (error) {
      // A concurrent or prior write already created it — that is success here.
      if (grpcCode(error) === GRPC.ALREADY_EXISTS) return
      throw mapGcpError(error, {ref: name})
    }
  }

  /** The replication policy from `location`: automatic, or single-region. */
  private replication(): ReplicationPolicy {
    if (this.location === undefined || this.location === 'global') {
      return {automatic: {}}
    }

    return {userManaged: {replicas: [{location: this.location}]}}
  }

  /** The `projects/.../secrets/NAME` resource for a (possibly foreign) name. */
  private secretResource(name: string): string {
    return name.startsWith('projects/') ? name : `projects/${this.projectId}/secrets/${name}`
  }

  /** The `.../versions/latest` resource to access for a name. */
  private versionResource(name: string): string {
    if (name.startsWith('projects/')) {
      return name.includes('/versions/') ? name : `${name}/versions/latest`
    }

    return `projects/${this.projectId}/secrets/${name}/versions/latest`
  }
}

/** Parse a JSON-encoded stored value back to its plaintext, defensively. */
function decodeValue(json: string, name: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new KeyshelfError('ADAPTER_ERROR', `Secret '${name}' holds a value Keyshelf did not write: ${String(error)}`, {
      ref: name,
    })
  }

  return typeof parsed === 'string' ? parsed : String(parsed)
}

/** A gRPC/GoogleError, narrowed to the fields we map on. */
interface GrpcError {
  code?: number
  message?: string
}

/** The numeric gRPC status of a thrown error, if it carries one. */
function grpcCode(error: unknown): number | undefined {
  const code = (error as GrpcError | undefined)?.code
  return typeof code === 'number' ? code : undefined
}

/**
 * Translate a failed Secret Manager call into a structured {@link KeyshelfError}.
 * gRPC surfaces a numeric status on the error; credential problems thrown by the
 * auth layer before any RPC carry no status, so we fall back to a message probe.
 */
function mapGcpError(error: unknown, ctx: {key?: string; ref: string}): KeyshelfError {
  const code = grpcCode(error)
  const message = (error as GrpcError | undefined)?.message ?? String(error)
  const fields = ctx.key === undefined ? {ref: ctx.ref} : {key: ctx.key, ref: ctx.ref}

  if (code === GRPC.NOT_FOUND) {
    return new KeyshelfError('SECRET_NOT_FOUND', `No secret stored for '${ctx.ref}'.`, fields)
  }

  if (code === GRPC.PERMISSION_DENIED || code === GRPC.UNAUTHENTICATED || isCredentialFailure(message)) {
    return new KeyshelfError('PROVIDER_AUTH', `Google Cloud rejected the credentials for '${ctx.ref}': ${firstLine(message)}`, fields)
  }

  return new KeyshelfError('ADAPTER_ERROR', `Secret Manager failed on '${ctx.ref}': ${firstLine(message)}`, fields)
}

/** Heuristic over auth-layer error messages thrown before any RPC is made. */
function isCredentialFailure(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('could not load the default credentials') ||
    m.includes('credential') ||
    m.includes('unauthenticated') ||
    m.includes('permission denied')
  )
}

/** The first non-empty line of a multi-line diagnostic, for terse messages. */
function firstLine(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length > 0) return trimmed
  }

  return ''
}

/** Coerce an explicit `!secret` ref payload to the stored name string. */
function refName(ref: unknown): string {
  if (typeof ref === 'string') return ref
  if (ref && typeof ref === 'object' && 'ref' in ref && typeof (ref as {ref: unknown}).ref === 'string') {
    return (ref as {ref: string}).ref
  }

  throw new KeyshelfError('ADAPTER_ERROR', `gcp adapter: unsupported !secret ref payload: ${JSON.stringify(ref)}`, {ref})
}
