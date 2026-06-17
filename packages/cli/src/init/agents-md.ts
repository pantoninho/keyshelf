/**
 * The keyshelf section scaffolded into a consuming repo's `AGENTS.md`.
 *
 * The section is a thin pointer at the authoritative, version-tracking sources
 * (`keyshelf check`, `keyshelf rules`, `docs/spec.md`) rather than a copy of the
 * ruleset, so the scaffolded text itself carries little that can rot. See
 * ADR-0003.
 */

export const KEYSHELF_SECTION_HEADING = "## keyshelf";

/** The body of the keyshelf section (heading included), with no trailing blank line. */
export function buildKeyshelfSection(): string {
  return [
    KEYSHELF_SECTION_HEADING,
    "Config and secrets are declared in keyshelf.config.ts.",
    "After editing it, run `keyshelf check`.",
    "Full agent rules: `keyshelf rules`. Spec: docs/spec.md."
  ].join("\n");
}

/**
 * Return AGENTS.md content with the keyshelf section present exactly once.
 *
 * - `existing === undefined` → no AGENTS.md yet; return a file containing just
 *   the section.
 * - existing content without a keyshelf section → append the section, leaving
 *   the rest untouched.
 * - existing content with a keyshelf section → replace only that section in
 *   place, leaving every other section untouched.
 *
 * Idempotent: feeding the output back in returns it unchanged.
 */
export function upsertKeyshelfSection(existing: string | undefined): string {
  const section = buildKeyshelfSection();

  if (existing === undefined || existing.trim() === "") {
    return `${section}\n`;
  }

  const lines = existing.split("\n");
  const startIdx = lines.findIndex((line) => line.trim() === KEYSHELF_SECTION_HEADING);

  if (startIdx === -1) {
    // No keyshelf section yet — append one, separated by a blank line.
    const base = existing.endsWith("\n") ? existing : `${existing}\n`;
    return `${base}\n${section}\n`;
  }

  // Replace the existing section in place. It runs until the next heading of the
  // same (top) level or the end of the file.
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      endIdx = i;
      break;
    }
  }

  const before = lines.slice(0, startIdx);
  const after = lines.slice(endIdx);
  const rebuilt = [...before, ...section.split("\n"), ...after];
  let result = rebuilt.join("\n");
  if (!result.endsWith("\n")) result += "\n";
  return result;
}
