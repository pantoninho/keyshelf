import path from "node:path";
import { describe, expect, it } from "vitest";
import { envFilePath, schemaFilePath, shelfDir, shelfEnvDir } from "../../src/paths.js";

const root = path.join("/proj", ".keyshelf");

describe("layout path helpers", () => {
  it("locates a shelf directory", () => {
    expect(shelfDir(root, "api")).toBe(path.join("/proj", ".keyshelf", "api"));
  });

  it("locates a shelf's schema file at the shelf root", () => {
    expect(schemaFilePath(root, "api")).toBe(path.join("/proj", ".keyshelf", "api", "schema.yaml"));
  });

  it("places environment files in the shelf's environments/ folder (ADR-0011)", () => {
    expect(shelfEnvDir(root, "api")).toBe(path.join("/proj", ".keyshelf", "api", "environments"));
    expect(envFilePath(root, "api", "production")).toBe(
      path.join("/proj", ".keyshelf", "api", "environments", "production.yaml")
    );
  });
});
