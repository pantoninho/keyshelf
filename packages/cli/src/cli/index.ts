import { Command } from "commander";
import { runCommand } from "./run.js";
import { lsCommand } from "./ls.js";
import { setCommand } from "./set.js";
import { importCommand } from "./import.js";
import { upCommand } from "./up.js";

const CLI_VERSION = "5.0.0";

export function createProgram(): Command {
  const program = new Command("keyshelf")
    .description("Keyshelf — config and secrets management for monorepos")
    .version(CLI_VERSION);

  program.addCommand(runCommand);
  program.addCommand(lsCommand);
  program.addCommand(setCommand);
  program.addCommand(importCommand);
  program.addCommand(upCommand);

  return program;
}
