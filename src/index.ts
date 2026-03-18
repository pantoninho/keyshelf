import { defineCommand, runMain } from "citty";
import { initCommand } from "@/commands/init";
import { setCommand } from "@/commands/set";
import { getCommand } from "@/commands/get";
import { runCommand } from "@/commands/run";
import { exportCommand } from "@/commands/export";

const main = defineCommand({
  meta: {
    name: "keyshelf",
    version: "0.1.0",
    description: "Config and secrets manager",
  },
  subCommands: {
    init: initCommand,
    set: setCommand,
    get: getCommand,
    run: runCommand,
    export: exportCommand,
  },
});

runMain(main);
