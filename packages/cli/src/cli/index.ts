import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { runCommand } from "./run.js";
import { lsCommand } from "./ls.js";
import { setCommand } from "./set.js";
import { importCommand } from "./import.js";
import { upCommand } from "./up.js";
import { cpCommand, cpClearCommand } from "./cp.js";
import { initCommand } from "./init.js";

/**
 * Read the CLI's own version from its package.json so `--version` always tracks
 * the published package and can never drift (see #153). Walks up from this
 * module's directory to the nearest package.json, which works identically from
 * source (tests/dev) and from the compiled `dist/` layout.
 */
function readPackageVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));

  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === "keyshelf" && pkg.version) {
        return pkg.version;
      }
    } catch {
      // No package.json at this level; keep walking up.
    }

    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error("keyshelf: unable to locate package.json to resolve CLI version");
    }
    dir = parent;
  }
}

export function createProgram(): Command {
  const program = new Command("keyshelf")
    .description("Keyshelf — config and secrets management for monorepos")
    .version(readPackageVersion());

  program.addCommand(initCommand);
  program.addCommand(runCommand);
  program.addCommand(lsCommand);
  program.addCommand(setCommand);
  program.addCommand(importCommand);
  program.addCommand(upCommand);
  program.addCommand(cpCommand);
  program.addCommand(cpClearCommand, { hidden: true });

  return program;
}
