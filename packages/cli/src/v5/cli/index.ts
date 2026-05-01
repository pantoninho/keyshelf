import { Command } from "commander";
import { runCommand } from "./run.js";
import { lsCommand } from "./ls.js";
import { setCommand } from "./set.js";
import { importCommand } from "./import.js";

const V5_VERSION = "5.0.0-alpha.0";

export function createV5Program(): Command {
  const program = new Command("keyshelf-next")
    .description("Keyshelf v5 development CLI")
    .version(V5_VERSION);

  program.addCommand(runCommand);
  program.addCommand(lsCommand);
  program.addCommand(setCommand);
  program.addCommand(importCommand);

  return program;
}
