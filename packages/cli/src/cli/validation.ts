import { resolveValidated } from "../resolver/index.js";
import type { Resolution } from "../resolver/types.js";

// Resolves every selected key exactly once, exits the process on any
// validation error, and returns the single Resolution for callers to render
// from — avoiding a second resolution pass.
export async function assertValidationPasses(
  resolveOpts: Parameters<typeof resolveValidated>[0]
): Promise<Resolution> {
  const { topLevelErrors, keyErrors, resolution } = await resolveValidated(resolveOpts);

  if (topLevelErrors.length > 0) {
    for (const err of topLevelErrors) console.error(`error: ${err.message}`);
    process.exit(1);
  }
  if (keyErrors.length > 0) {
    console.error("Validation errors:");
    for (const err of keyErrors) console.error(`  - ${err.path}: ${err.message}`);
    process.exit(1);
  }

  // Unreachable when no top-level error short-circuits resolution.
  if (resolution === undefined) {
    console.error("error: resolution did not complete");
    process.exit(1);
  }

  return resolution;
}
