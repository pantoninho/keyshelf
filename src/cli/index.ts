import { Command } from "commander";
import { runCommand } from "./run.js";
import { setCommand } from "./set.js";
import { importCommand } from "./import.js";
import { lsCommand } from "./ls.js";
import { rmCommand } from "./rm.js";

export function createProgram(): Command {
  const program = new Command("keyshelf")
    .description("Config and secrets management for monorepos")
    .version("0.1.0");

  program.addCommand(runCommand);
  program.addCommand(setCommand);
  program.addCommand(importCommand);
  program.addCommand(lsCommand);
  program.addCommand(rmCommand);

  return program;
}
