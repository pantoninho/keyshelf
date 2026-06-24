import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { KeyshelfError } from "../errors.js";
import type { Adapter, AdapterMetadata } from "./adapter.js";
import { conventionName, firstLine, refName } from "./shared.js";

/**
 * The gcp adapter (ADR-0002, ADR-0006). It stores each key as its own Google
 * Cloud Secret Manager *secret* and writes a new *version* per `write`; `resolve`
 * reads the `latest` version. Authentication is Application Default Credentials —
 * the SDK discovers them from `GOOGLE_APPLICATION_CREDENTIALS`, `gcloud` ADC, or
 * the metadata server — so Keyshelf owns no credentials of its own.
 *
 * **Store.** One secret per key in the configured `projectId`, named by the fixed
 * reference convention `keyshelf__{project}__{shelf}__{stage}__{key}`
 * (docs/reference.md). The `keyshelf__{project}__{shelf}__{stage}` prefix is the
 * adapter's `namespace`, so the same key in two environments stays distinct in
 * the shared backend. `location` selects
 * the replication policy: absent or `global` ⇒ automatic replication; any other
 * value ⇒ user-managed replication pinned to that single region.
 *
 * **Value encoding.** The value is stored as its raw UTF-8 bytes —
 * `write` writes `Buffer.from(value, "utf8")` and `resolve` returns the bytes
 * verbatim. Unlike the sops adapter (which carries a JSON string to survive
 * YAML's implicit typing), Secret Manager stores an opaque byte blob, so raw
 * bytes round-trip byte-exactly for every value — newlines, whitespace, quotes,
 * unicode, multi-KB blobs — with no envelope. Storing the literal value is what
 * lets *native* consumers (Cloud Run secret mounts, `gcloud`, Terraform, other
 * services) read the secret directly without unwrapping a JSON quote.
 *
 * The one value with no raw representation is the **empty string**: Secret
 * Manager rejects an empty payload, and an empty payload has no native form to
 * mount anyway. So `write` rejects an empty value with `ADAPTER_ERROR` rather
 * than smuggle it through an envelope no native consumer could read. This is the
 * single, deliberate divergence from the uniform empty-string round-trip the
 * adapter contract otherwise requires (ADR-0005, ADR-0006).
 *
 * **Reference.** Convention resolution is by key name: `write(key, value)` stores
 * under the composed secret id and returns that id, which equals the convention
 * `set` resolves by — so a matching `set` records a bare `!secret`. An explicit
 * `!secret { ref: NAME }` resolves a differently-named secret; a `NAME` that is a
 * full `projects/.../secrets/...` resource path resolves a foreign secret (any
 * project), otherwise it is a bare secret id in the configured `projectId`.
 * Because values are stored raw, a foreign or hand-created secret (which holds
 * its own literal bytes, not a JSON envelope) resolves correctly.
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
  UNAUTHENTICATED: 16
} as const;

/**
 * The slice of `SecretManagerServiceClient` the adapter depends on. Narrowing to
 * these three calls keeps the adapter unit-testable with an in-memory double —
 * the gcp conformance suite is gated on real infrastructure (ADR-0005), so the
 * hermetic per-PR coverage of the adapter's own logic rides on this seam.
 */
export interface SecretsClient {
  accessSecretVersion(request: { name: string }): Promise<[AccessResponse, ...unknown[]]>;
  createSecret(request: {
    parent: string;
    secretId: string;
    secret: { replication: ReplicationPolicy };
  }): Promise<[unknown, ...unknown[]]>;
  addSecretVersion(request: {
    parent: string;
    payload: { data: Buffer };
  }): Promise<[unknown, ...unknown[]]>;
}

/** The fields of an accessSecretVersion response the adapter reads. */
interface AccessResponse {
  payload?: { data?: Uint8Array | string | null } | null;
}

/** A Secret Manager replication policy: automatic, or pinned to one region. */
type ReplicationPolicy =
  | { automatic: Record<string, never> }
  | { userManaged: { replicas: Array<{ location: string }> } };

export class GcpAdapter implements Adapter {
  private readonly client: SecretsClient;
  private readonly projectId: string;
  private readonly namespace: string;
  private readonly location?: string;

  constructor(opts: {
    projectId: string;
    namespace: string;
    location?: string;
    client?: SecretsClient;
  }) {
    this.projectId = opts.projectId;
    this.namespace = opts.namespace;
    this.location = opts.location;
    this.client = opts.client ?? (new SecretManagerServiceClient() as unknown as SecretsClient);
  }

  async resolve(key: string, ref?: unknown): Promise<string> {
    const name = this.storedName(key, ref);
    const version = this.versionResource(name);
    let response: AccessResponse;
    try {
      [response] = await this.client.accessSecretVersion({ name: version });
    } catch (error) {
      throw mapGcpError(error, { key, ref: name });
    }

    const data = response.payload?.data;
    if (data === undefined || data === null) {
      // A version with no payload should not happen for values we wrote, but a
      // foreign or hand-created secret could have one — treat it as absent.
      throw new KeyshelfError(
        "SECRET_NOT_FOUND",
        `Secret '${name}' has no payload in its latest version.`,
        {
          key,
          ref: name
        }
      );
    }

    // The value is stored as its raw UTF-8 bytes, so the payload *is* the value.
    // `data` is bytes (a Buffer) for our writes, but the API may hand back a
    // base64 string in some transports — Buffer.from handles both via the right
    // coding.
    return typeof data === "string"
      ? Buffer.from(data, "base64").toString("utf8")
      : Buffer.from(data).toString("utf8");
  }

  async write(key: string, value: string): Promise<unknown> {
    if (value === "") {
      // Secret Manager rejects an empty payload, and an empty secret has no form
      // a native consumer (Cloud Run mount, gcloud) could read. Rather than
      // smuggle it through an envelope, refuse it up front with a clear message.
      throw new KeyshelfError(
        "ADAPTER_ERROR",
        "The gcp adapter cannot store an empty value: Google Cloud Secret Manager rejects empty secret payloads.",
        { key }
      );
    }

    const name = conventionName(this.namespace, key);
    await this.ensureSecret(name);
    try {
      await this.client.addSecretVersion({
        parent: this.secretResource(name),
        payload: { data: Buffer.from(value, "utf8") }
      });
    } catch (error) {
      throw mapGcpError(error, { key, ref: name });
    }

    // The value is stored under the convention secret id, which is exactly the
    // name `set` resolves by — returning it records a bare `!secret`, and a
    // foreign environment can reference it explicitly via `!secret { ref: name }`.
    return name;
  }

  /**
   * The offline Secret Manager address of a key — the `.../versions/latest`
   * resource `resolve` would read, computed by the same pure naming the adapter
   * already does (convention or explicit ref) plus {@link versionResource}. No
   * client call, no credentials (ADR-0008): the value is never fetched, only its
   * location is composed.
   */
  metadata(key: string, ref?: unknown): AdapterMetadata {
    return { adapter: "gcp", resource: this.versionResource(this.storedName(key, ref)) };
  }

  /**
   * The stored secret name for a key: the convention `{namespace}__{key}` when no
   * explicit ref is given, otherwise the coerced ref payload. Shared by `resolve`
   * (which then accesses it) and `metadata` (which only addresses it).
   */
  private storedName(key: string, ref: unknown): string {
    return ref === undefined ? conventionName(this.namespace, key) : refName("gcp", ref);
  }

  /** Create the secret container if it does not already exist (idempotent). */
  private async ensureSecret(name: string): Promise<void> {
    try {
      await this.client.createSecret({
        parent: `projects/${this.projectId}`,
        secretId: name,
        secret: { replication: this.replication() }
      });
    } catch (error) {
      // A concurrent or prior write already created it — that is success here.
      if (grpcCode(error) === GRPC.ALREADY_EXISTS) return;
      throw mapGcpError(error, { ref: name });
    }
  }

  /** The replication policy from `location`: automatic, or single-region. */
  private replication(): ReplicationPolicy {
    if (this.location === undefined || this.location === "global") {
      return { automatic: {} };
    }

    return { userManaged: { replicas: [{ location: this.location }] } };
  }

  /** The `projects/.../secrets/NAME` resource for a (possibly foreign) name. */
  private secretResource(name: string): string {
    return name.startsWith("projects/") ? name : `projects/${this.projectId}/secrets/${name}`;
  }

  /** The `.../versions/latest` resource to access for a name. */
  private versionResource(name: string): string {
    if (name.startsWith("projects/")) {
      return name.includes("/versions/") ? name : `${name}/versions/latest`;
    }

    return `projects/${this.projectId}/secrets/${name}/versions/latest`;
  }
}

/** A gRPC/GoogleError, narrowed to the fields we map on. */
interface GrpcError {
  code?: number;
  message?: string;
}

/** The numeric gRPC status of a thrown error, if it carries one. */
function grpcCode(error: unknown): number | undefined {
  const code = (error as GrpcError | undefined)?.code;
  return typeof code === "number" ? code : undefined;
}

/**
 * Translate a failed Secret Manager call into a structured {@link KeyshelfError}.
 * gRPC surfaces a numeric status on the error; credential problems thrown by the
 * auth layer before any RPC carry no status, so we fall back to a message probe.
 */
function mapGcpError(error: unknown, ctx: { key?: string; ref: string }): KeyshelfError {
  const code = grpcCode(error);
  const message = (error as GrpcError | undefined)?.message ?? String(error);
  const fields = ctx.key === undefined ? { ref: ctx.ref } : { key: ctx.key, ref: ctx.ref };

  if (code === GRPC.NOT_FOUND) {
    return new KeyshelfError("SECRET_NOT_FOUND", `No secret stored for '${ctx.ref}'.`, fields);
  }

  if (
    code === GRPC.PERMISSION_DENIED ||
    code === GRPC.UNAUTHENTICATED ||
    isCredentialFailure(message)
  ) {
    return new KeyshelfError(
      "PROVIDER_AUTH",
      `Google Cloud rejected the credentials for '${ctx.ref}': ${firstLine(message)}`,
      fields
    );
  }

  return new KeyshelfError(
    "ADAPTER_ERROR",
    `Secret Manager failed on '${ctx.ref}': ${firstLine(message)}`,
    fields
  );
}

/** Heuristic over auth-layer error messages thrown before any RPC is made. */
function isCredentialFailure(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("could not load the default credentials") ||
    m.includes("credential") ||
    m.includes("unauthenticated") ||
    m.includes("permission denied")
  );
}
