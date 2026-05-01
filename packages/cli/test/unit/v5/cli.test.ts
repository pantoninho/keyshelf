import { describe, expect, it } from "vitest";
import { createV5Program } from "../../../src/v5/index.js";

describe("createV5Program", () => {
  it("registers run, ls, set, and import commands", () => {
    const program = createV5Program();
    expect(program.name()).toBe("keyshelf-next");
    expect(program.commands.map((command) => command.name()).sort()).toEqual([
      "import",
      "ls",
      "run",
      "set"
    ]);
  });
});
