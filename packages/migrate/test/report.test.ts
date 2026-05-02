import { describe, expect, it } from "vitest";
import { buildReport } from "../src/report.js";
import { loadFixture } from "./test-utils.js";

describe("buildReport", () => {
  it("prints counts, rebind commands, and review notes", async () => {
    const report = buildReport(await loadFixture("basic"));

    expect(report).toContain("Migrated 4 keys (3 config, 1 secret) across 1 envs.");
    expect(report).toContain("keyshelf set --env dev --provider age db/password");
    expect(report).toContain("Root .env.keyshelf remains separate (5 mappings, 1 templates).");
  });
});
