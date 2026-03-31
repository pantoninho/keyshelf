import { Command } from "commander";
import spawn from "cross-spawn";
import { loadConfig } from "../config/loader.js";
import { resolve, validate } from "../resolver/index.js";
import { createDefaultRegistry } from "../providers/setup.js";
import { createCache } from "./cache.js";

export const runCommand = new Command("run")
  .description("Resolve secrets and run a command with env vars injected")
  .requiredOption("--env <env>", "Environment name")
  .option("--map <file>", "Path to app mapping file (default: .env.keyshelf)")
  .argument("<command...>", "Command to run")
  .allowExcessArguments(true)
  .action(async (commandArgs: string[], opts: { env: string; map?: string }) => {
    const appDir = process.cwd();
    const config = await loadConfig(appDir, opts.env, { mappingFile: opts.map });
    const registry = createDefaultRegistry();
    const cache = createCache(config);

    const resolveOpts = {
      schema: config.schema,
      env: config.env,
      envName: opts.env,
      registry,
      cache
    };

    const errors = await validate(resolveOpts);
    if (errors.length > 0) {
      console.error("Validation errors:");
      for (const err of errors) {
        console.error(`  - ${err.path}: ${err.message}`);
      }
      process.exit(1);
    }

    const resolved = await resolve(resolveOpts);

    const envVars: Record<string, string> = {};
    const resolvedMap = new Map(resolved.map((r) => [r.path, r.value]));

    for (const mapping of config.appMapping) {
      const value = resolvedMap.get(mapping.keyPath);
      if (value !== undefined) {
        envVars[mapping.envVar] = value;
      } else {
        console.error(
          `warning: ${mapping.envVar} maps to "${mapping.keyPath}" which is not defined in schema`
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
