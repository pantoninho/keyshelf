import { describe, expect, it, vi } from "vitest";
import { createV5Program } from "../../../src/v5/index.js";

describe("createV5Program", () => {
  it("creates an isolated keyshelf-next program", () => {
    const program = createV5Program();

    expect(program.name()).toBe("keyshelf-next");
    expect(program.commands.map((command) => command.name())).toEqual(["status"]);
  });

  it("reports phase 1 status", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await createV5Program().parseAsync(["node", "keyshelf-next", "status"]);

    expect(log).toHaveBeenCalledWith("keyshelf v5 phase 1 scaffold is installed");
    log.mockRestore();
  });
});
