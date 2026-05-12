import { describe, expect, it } from "vitest";
import { createProgram } from "../../src/index.js";

describe("createProgram", () => {
  it("registers run, ls, set, import, up, cp, and __cp-clear commands", () => {
    const program = createProgram();
    expect(program.name()).toBe("keyshelf");
    expect(program.commands.map((command) => command.name()).sort()).toEqual([
      "__cp-clear",
      "cp",
      "import",
      "ls",
      "run",
      "set",
      "up"
    ]);
  });
});
