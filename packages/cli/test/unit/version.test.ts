import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { createProgram } from "../../src/index.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

describe("CLI --version", () => {
  it("reports the version from the package's own package.json", () => {
    const program = createProgram();
    expect(program.version()).toBe(pkg.version);
  });

  it("does not report a stale hardcoded version", () => {
    const program = createProgram();
    // Regression guard for #153: the CLI used to hardcode "5.0.0" while the
    // package was 5.3.0. The version must always track package.json.
    expect(program.version()).toBe(pkg.version);
    expect(pkg.version).not.toBe("");
  });
});
