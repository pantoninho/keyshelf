import { KeyshelfError } from "../../src/errors.js";

/**
 * Run `fn` expecting it to reject with a {@link KeyshelfError}, and return that
 * error for assertions on its `code`/`fields`. Anything else — a non-Keyshelf
 * rejection, or no rejection at all — fails the test loudly. Shared by the
 * adapter conformance suite and the per-adapter unit tests.
 */
export async function captureError(fn: () => Promise<unknown>): Promise<KeyshelfError> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof KeyshelfError) return error;
    throw new Error(`expected a KeyshelfError, got: ${String(error)}`, { cause: error });
  }

  throw new Error("expected a KeyshelfError, but nothing was thrown");
}
