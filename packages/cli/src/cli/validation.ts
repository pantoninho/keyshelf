import { validate } from "../resolver/index.js";

export async function assertValidationPasses(
  resolveOpts: Parameters<typeof validate>[0]
): Promise<void> {
  const validation = await validate(resolveOpts);
  if (validation.topLevelErrors.length > 0) {
    for (const err of validation.topLevelErrors) console.error(`error: ${err.message}`);
    process.exit(1);
  }
  if (validation.keyErrors.length > 0) {
    console.error("Validation errors:");
    for (const err of validation.keyErrors) console.error(`  - ${err.path}: ${err.message}`);
    process.exit(1);
  }
}
