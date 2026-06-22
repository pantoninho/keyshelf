import { KeyshelfError } from "./errors.js";

/**
 * Parse a `<shelf>/<stage>` environment address (docs/reference.md "CLI surface"),
 * mapping a malformed argument to `MALFORMED_FILE`. Exactly one `/`, with a
 * non-empty shelf and stage on either side.
 */
export function parseTarget(target: string): { shelf: string; stage: string } {
  const slash = target.indexOf("/");
  if (slash <= 0 || slash === target.length - 1 || target.indexOf("/", slash + 1) !== -1) {
    throw new KeyshelfError(
      "MALFORMED_FILE",
      `'${target}' is not a valid environment address; expected '<shelf>/<stage>'.`,
      { reason: "expected '<shelf>/<stage>'", target }
    );
  }

  return { shelf: target.slice(0, slash), stage: target.slice(slash + 1) };
}
