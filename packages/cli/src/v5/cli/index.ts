import { Command } from "commander";

const V5_VERSION = "5.0.0-alpha.0";

export function createV5Program(): Command {
  const program = new Command("keyshelf-next")
    .description("Keyshelf v5 development CLI")
    .version(V5_VERSION);

  program.addCommand(createStatusCommand());

  return program;
}

function createStatusCommand(): Command {
  return new Command("status").description("Show v5 implementation status").action(() => {
    console.log("keyshelf v5 phase 1 scaffold is installed");
  });
}
