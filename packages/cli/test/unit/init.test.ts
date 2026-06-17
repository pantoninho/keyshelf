import { describe, expect, it } from "vitest";
import {
  KEYSHELF_SECTION_HEADING,
  buildKeyshelfSection,
  upsertKeyshelfSection
} from "../../src/init/agents-md.js";

describe("buildKeyshelfSection", () => {
  it("starts with the keyshelf heading and points at the version-tracking commands", () => {
    const section = buildKeyshelfSection();
    expect(section.startsWith(`${KEYSHELF_SECTION_HEADING}\n`)).toBe(true);
    expect(section).toContain("keyshelf.config.ts");
    expect(section).toContain("keyshelf check");
    expect(section).toContain("keyshelf rules");
    expect(section).toContain("docs/spec.md");
  });
});

describe("upsertKeyshelfSection", () => {
  it("creates the section when there is no existing AGENTS.md content", () => {
    const result = upsertKeyshelfSection(undefined);
    expect(result).toContain(KEYSHELF_SECTION_HEADING);
    expect(result.endsWith("\n")).toBe(true);
  });

  it("appends the section, preserving existing content, when AGENTS.md exists without one", () => {
    const existing = "# AGENTS.md\n\n## build\nRun `npm test`.\n";
    const result = upsertKeyshelfSection(existing);
    expect(result).toContain("## build");
    expect(result).toContain("Run `npm test`.");
    expect(result).toContain(KEYSHELF_SECTION_HEADING);
    // existing content stays at the top, untouched
    expect(result.startsWith("# AGENTS.md\n\n## build\nRun `npm test`.\n")).toBe(true);
  });

  it("is idempotent: running twice does not duplicate the section", () => {
    const once = upsertKeyshelfSection(undefined);
    const twice = upsertKeyshelfSection(once);
    expect(twice).toBe(once);
    const occurrences = twice.split(KEYSHELF_SECTION_HEADING).length - 1;
    expect(occurrences).toBe(1);
  });

  it("replaces only the keyshelf section, leaving other sections untouched", () => {
    const existing = [
      "# AGENTS.md",
      "",
      "## build",
      "Run `npm test`.",
      "",
      KEYSHELF_SECTION_HEADING,
      "Stale outdated text that should be replaced.",
      "",
      "## deploy",
      "Push to main.",
      ""
    ].join("\n");
    const result = upsertKeyshelfSection(existing);
    expect(result).toContain("## build");
    expect(result).toContain("## deploy");
    expect(result).toContain("Push to main.");
    expect(result).not.toContain("Stale outdated text");
    expect(result).toContain("keyshelf check");
    // exactly one keyshelf section
    expect(result.split(KEYSHELF_SECTION_HEADING).length - 1).toBe(1);
  });
});
