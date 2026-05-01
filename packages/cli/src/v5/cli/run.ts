import { Command } from "commander";
import spawn from "cross-spawn";
import { loadV5Config } from "../config/index.js";
import {
  formatSkipCause,
  renderAppMapping,
  resolveWithStatus,
  validate
} from "../resolver/index.js";
import { createDefaultRegistry } from "../../providers/setup.js";
import { splitList } from "./options.js";

interface RunOptions {
  env?: string;
  group?: string;
  filter?: string;
  map?: string;
}

export const runCommand = new Command("run")
  .description("Resolve keys and run a command with env vars injected")
  .option("--env <env>", "Environment name")
  .option("--group <names>", "Comma-separated group filter")
  .option("--filter <prefixes>", "Comma-separated key-path prefix filter")
  .option("--map <file>", "Path to app mapping file (default: .env.keyshelf)")
  .argument("<command...>", "Command to run")
  .allowExcessArguments(true)
  .action(async (commandArgs: string[], opts: RunOptions) => {
    const appDir = process.cwd();
    const loaded = await loadV5Config(appDir, { mappingFile: opts.map });
    const registry = createDefaultRegistry();

    const resolveOpts = {
      config: loaded.config,
      envName: opts.env,
      rootDir: loaded.rootDir,
      registry,
      groups: splitList(opts.group),
      filters: splitList(opts.filter)
    };

    const validation = await validate(resolveOpts);
    if (validation.topLevelErrors.length > 0) {
      for (const err of validation.topLevelErrors) console.error(`error: ${err.message}`);
      process.exit(1);
    }
    if (validation.keyErrors.length > 0) {
      console.error("Validation errors:");
      for (const err of validation.keyErrors) console.error(`  - ${err.path}: ${err.message}`);
      process.exit(1);
    }

    const resolution = await resolveWithStatus(resolveOpts);
    const rendered = renderAppMapping(loaded.appMapping, resolution);

    const envVars: Record<string, string> = {};
    for (const result of rendered) {
      if (result.status === "rendered") {
        envVars[result.envVar] = result.value;
      } else {
        console.error(
          `keyshelf: skipping ${result.envVar} — referenced key '${result.keyPath}' ${formatSkipCause(result.cause)}`
        );
      }
    }

    const [cmd, ...args] = commandArgs;
    const child = spawn(cmd, args, {
      stdio: "inherit",
      env: { ...envVars, ...process.env }
    });

    child.on("close", (code) => {
      process.exit(code ?? 1);
    });

    child.on("error", (err) => {
      console.error(`Failed to start command: ${err.message}`);
      process.exit(1);
    });
  });
