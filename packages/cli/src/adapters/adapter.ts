// Imported solely so the {@link KeyshelfError} / @throws references in this
// file's TSDoc resolve; it is not referenced in value or type position here.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { KeyshelfError } from "../errors.js";

/**
 * The offline, backend-specific *address* of a stored key — never its value. Each
 * adapter contributes its own variant, discriminated on `adapter`, so a consumer
 * can locate the secret in the backend (a GCP console URL, an IAM grant target, a
 * sops file path) without resolving it. This is pure config math: it is derivable
 * from already-parsed config plus the key/ref, with zero network and zero
 * credentials (ADR-0008).
 *
 * The shape is deliberately per-adapter rather than a flat string: a `gcp`
 * resource path and a `sops` file+key are not the same kind of address, and a
 * discriminated union lets each consumer destructure the one it expects.
 */
export type AdapterMetadata =
  /** The full `projects/.../secrets/.../versions/latest` Secret Manager resource. */
  { adapter: "gcp"; resource: string };

/**
 * The sole seam for backend-specific behavior (ADR-0002). An adapter is the code
 * that talks to one type of backend (sops, gcp, the in-memory fake); a
 * {@link Provider} is a configured instance of one. Every adapter implements
 * exactly these two methods, and *all* backend-specific code — including
 * authentication via the backend's native credential mechanism — lives behind
 * this interface.
 *
 * Implementations must, uniformly across backends:
 * - map a missing secret to a {@link KeyshelfError} with code `SECRET_NOT_FOUND`;
 * - map a credential/auth failure to `PROVIDER_AUTH`;
 * - map a missing backend prerequisite to `ADAPTER_UNAVAILABLE`;
 * - map other backend op failures to `ADAPTER_ERROR`;
 * - round-trip values byte-exactly (write then resolve yields the same bytes,
 *   including embedded newlines, surrounding whitespace, `=`, quotes, unicode,
 *   and multi-KB blobs). The empty string round-trips too, with one sanctioned
 *   exception: a backend that cannot represent an empty value (the gcp adapter —
 *   Secret Manager rejects empty payloads, ADR-0006) instead rejects it on
 *   `write` with `ADAPTER_ERROR`.
 *
 * These obligations are proven by the shared adapter-contract conformance suite
 * (ADR-0005), which every adapter runs by supplying a harness.
 */
export interface Adapter {
  /**
   * Fetch a secret's plaintext value from the store.
   *
   * @param key  the environment key name. By convention it locates the value in
   *   the store (the reference adapters compose it as `keyshelf__{project}__{shelf}__{stage}__{key}`).
   * @param ref  the optional explicit reference payload from a
   *   `!secret { ref: ... }`, which overrides the convention to resolve a
   *   differently-named or foreign stored value. `undefined` means
   *   convention resolution.
   * @returns the value's plaintext, byte-exact.
   * @throws {KeyshelfError} `SECRET_NOT_FOUND` when no value is stored; other
   *   codes per the mapping above.
   */
  resolve(key: string, ref?: unknown): Promise<string>;

  /**
   * Persist a secret's plaintext value into the store.
   *
   * @param key    the environment key name (the convention location).
   * @param value  the plaintext to store, preserved byte-exactly.
   * @returns the reference to record for this key in the environment file. A
   *   convention-resolvable write may return `undefined` (bare `!secret`); a
   *   foreign/explicit write returns the payload to embed under `{ ref: ... }`.
   */
  write(key: string, value: string): Promise<unknown>;

  /**
   * Compute this key's backend **address** — its storage location, never its
   * value (ADR-0008). Optional: an adapter that cannot derive an address without
   * a network round-trip must not implement this (so the field is simply omitted
   * from the view), never fetch.
   *
   * **Contract (load-bearing):**
   * - **Synchronous** — returns {@link AdapterMetadata}, not a `Promise`. The
   *   non-promise signature structurally forbids async I/O: there is no awaitable
   *   to hang a backend call on.
   * - **Network-free and credential-free.** Computes purely from the
   *   already-parsed config (captured at construction) plus the key/ref. It makes
   *   no client calls and resolves no credentials.
   *
   * @param key  the environment key name (the convention location).
   * @param ref  the optional explicit `!secret { ref: ... }` payload; `undefined`
   *   means convention addressing.
   * @returns the backend address for the key.
   */
  metadata?(key: string, ref?: unknown): AdapterMetadata;
}
