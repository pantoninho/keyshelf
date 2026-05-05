import { describe, expect, it } from "vitest";
import { createProgram } from "../../src/index.js";

describe("createProgram", () => {
  it("registers run, ls, set, import, and up commands", () => {
    const program = createProgram();
    expect(program.name()).toBe("keyshelf");
    expect(program.commands.map((command) => command.name()).sort()).toEqual([
      "import",
      "ls",
      "run",
      "set",
      "up"
    ]);
  });
});
