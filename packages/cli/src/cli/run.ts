import { Command } from "commander";
import spawn from "cross-spawn";
import { loadConfig } from "../config/index.js";
import { isTemplateMapping, type AppMapping } from "../config/app-mapping.js";
import {
  findNotApplicableMapReferences,
  formatSkipCause,
  renderAppMapping
} from "../resolver/index.js";
import { createDefaultRegistry } from "../providers/setup.js";
import { splitList } from "./options.js";
import { assertValidationPasses } from "./validation.js";

interface RunOptions {
  env?: string;
  group?: string;
  filter?: string;
  map?: string;
}

export const runCommand = new Command("run")
  .description(
    "Resolve keys through their bound providers and run a command with the mapped env vars injected"
  )
  .option(
    "--env <env>",
    "Environment name (only required when a selected key has values without a fallback)"
  )
  .option("--group <names>", "Comma-separated group filter; keys outside the set are skipped")
  .option(
    "--filter <prefixes>",
    "Comma-separated key-path prefix filter (e.g. db,log); non-matching keys are skipped"
  )
  .option("--map <file>", "Path to app mapping file (default: .env.keyshelf)")
  .argument("<command...>", "Command to run")
  .allowExcessArguments(true)
  .action(async (commandArgs: string[], opts: RunOptions) => {
    const appDir = process.cwd();
    const loaded = await loadConfig(appDir, { mappingFile: opts.map });
    const registry = createDefaultRegistry();

    // ADR-0002: a --map entry that names a key N/A in the active env is an
    // error (the env does not have that key), not a silent drop or skip warning
    // — the same posture as referencing a key that does not exist. Fail before
    // resolving or spawning the subprocess.
    const naReferences = findNotApplicableMapReferences(loaded.config, loaded.appMapping, opts.env);
    if (naReferences.length > 0) {
      for (const ref of naReferences) {
        console.error(
          `error: ${ref.envVar}: key "${ref.keyPath}" is N/A (not applicable) in the active env "${ref.envName}" — add "${ref.envName}" to its applicable envs in keyshelf.config.ts, or drop the reference`
        );
      }
      process.exit(1);
    }

    const resolveOpts = {
      config: loaded.config,
      envName: opts.env,
      rootDir: loaded.rootDir,
      registry,
      groups: splitList(opts.group),
      filters: splitList(opts.filter),
      // Scope resolution + validation to the keys this app actually maps.
      // Keys unreachable from .env.keyshelf are never resolved, so an
      // unseeded secret belonging to another app can't fail this run.
      roots: appMappingRoots(loaded.appMapping)
    };

    const resolution = await assertValidationPasses(resolveOpts);
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

// The key paths directly referenced by the app mapping — the resolution roots.
// Transitive `${...}` expansion through config templates happens in the resolver.
function appMappingRoots(mappings: AppMapping[]): string[] {
  const roots = new Set<string>();
  for (const mapping of mappings) {
    if (isTemplateMapping(mapping)) {
      for (const keyPath of mapping.keyPaths) roots.add(keyPath);
    } else {
      roots.add(mapping.keyPath);
    }
  }
  return [...roots];
}
