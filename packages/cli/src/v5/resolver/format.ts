import type { V5SkipCause } from "./types.js";

export function formatSkipCause(cause: V5SkipCause): string {
  switch (cause.type) {
    case "group-filter":
      return `is filtered out by --group=${cause.activeGroups.join(",")}`;
    case "path-filter":
      return `is filtered out by --filter=${cause.activePrefixes.join(",")}`;
    case "optional-no-value":
      return "is optional and has no value";
    case "optional-not-found":
      return "is optional and was not found in its provider";
    case "template-ref-unavailable":
      return `is unavailable: referenced key '${cause.reference}' ${formatSkipCause(cause.referenceCause)}`;
  }
}
