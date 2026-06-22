// Imported solely so the {@link KeyshelfError} / @throws references in this
// file's TSDoc resolve; it is not referenced in value or type position here.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { KeyshelfError } from "../errors.js";

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
 *   multi-KB blobs, and the empty string).
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
}
