import { spawn } from "node:child_process";
import { Args, Flags } from "@oclif/core";
import { resolveDepsFor } from "../adapters/registry.js";
import { BaseCommand } from "../base-command.js";
import { KeyshelfError } from "../errors.js";
import { loadEnvironment } from "../loader.js";
import { buildChildEnv, parseSet, resolveEnvironment } from "../resolve.js";
import { parseTarget } from "../target.js";
import { validateEnvironment } from "../validate.js";

/**
 * Resolve a `{shelf}/{stage}`'s config into environment variables, overlay them on
 * the inherited process environment, and exec a wrapped command.
 *
 * Surface: `keyshelf run <shelf>/<stage> [--set KEY=VALUE]... -- <cmd> [args...]`.
 * Everything after the `--` separator is the wrapped command and its own
 * arguments, captured verbatim — its flags are never interpreted by keyshelf.
 *
 * Resolution is fail-fast (docs/reference.md "run resolution & precedence"):
 * load + structurally validate + resolve before exec; on any error keyshelf
 * aborts and never launches a half-populated environment. Precedence, highest to
 * lowest: explicit `--set` → keyshelf's resolved value → inherited ambient env
 * (only for keys keyshelf does not manage). The wrapped command's exit code is
 * propagated as keyshelf's exit status.
 *
 * Every `!secret` resolves through the environment's provider's adapter
 * (convention by key name, or the explicit `{ ref: ... }` override) as part of
 * the pre-exec resolution; an unresolvable secret aborts before exec.
 */
export default class Run extends BaseCommand {
  static description =
    "Resolve a shelf/stage's config into env vars and exec a wrapped command after '--'.";

  static examples = [
    "<%= config.bin %> run web/staging -- printenv REGION",
    "<%= config.bin %> run web/staging --set LOG_LEVEL=trace -- node server.js"
  ];

  // The wrapped command and its arguments are arbitrary positionals; oclif must
  // not reject them. We split argv on `--` ourselves so the wrapped command's own
  // flags are never parsed as keyshelf flags.
  static strict = false;

  static args = {
    target: Args.string({
      description: "The environment to run as <shelf>/<stage>.",
      required: true
    })
  };

  static flags = {
    set: Flags.string({
      description: "Override or add an env var (highest precedence). Repeatable. KEY=VALUE.",
      multiple: true
    })
  };

  async run(): Promise<never> {
    const { target, command } = this.splitArgv();

    const { shelf, stage } = parseTarget(target);

    // --set flags (and --json) live before `--`; parse only that left side.
    const { flags } = await this.parse(Run);
    const sets: Record<string, string> = {};
    for (const assignment of flags.set ?? []) {
      const { key, value } = parseSet(assignment);
      sets[key] = value;
    }

    // Fail-fast: load + structurally validate + resolve before exec.
    const projectDir = process.cwd();
    const loaded = await loadEnvironment(projectDir, shelf, stage);
    validateEnvironment(loaded);

    // Secrets resolve through the environment's provider's adapter, built lazily
    // (only if the environment declares a !secret). A !ref resolves one hop
    // through the *target* environment's provider — resolveDepsFor builds each
    // environment's adapter from its own provider and loads target shelves.
    const managed = await resolveEnvironment(loaded, resolveDepsFor(projectDir));

    const childEnv = buildChildEnv({ ambient: process.env, managed, sets });

    return this.exec(command, childEnv);
  }

  /**
   * Split the raw argv on the first `--` separator. The left side carries
   * keyshelf's own flags/args; the right side is the wrapped command + args,
   * captured verbatim.
   */
  private splitArgv(): { target: string; command: string[] } {
    const raw = this.argv;
    const sep = raw.indexOf("--");
    if (sep === -1) {
      throw new KeyshelfError(
        "MALFORMED_FILE",
        "run requires a wrapped command after '--' (e.g. 'keyshelf run web/staging -- printenv').",
        { reason: "missing '--' separator" }
      );
    }

    const command = raw.slice(sep + 1);
    if (command.length === 0) {
      throw new KeyshelfError("MALFORMED_FILE", "run requires a command after '--'.", {
        reason: "empty command after '--'"
      });
    }

    // The target is the first non-flag token before `--`.
    const left = raw.slice(0, sep);
    const target = left.find((token) => !token.startsWith("-"));
    if (target === undefined) {
      throw new KeyshelfError("MALFORMED_FILE", "run requires a <shelf>/<stage> target.", {
        reason: "missing <shelf>/<stage> target"
      });
    }

    return { target, command };
  }

  /** Spawn the wrapped command, propagate its exit code, map spawn failure to EXEC_FAILED. */
  private async exec(command: string[], childEnv: Record<string, string>): Promise<never> {
    const [cmd, ...args] = command;

    const status = await new Promise<number>((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: "inherit", env: childEnv });

      child.on("error", (error) => {
        reject(
          new KeyshelfError("EXEC_FAILED", `Could not start command '${cmd}': ${error.message}`, {
            command: cmd,
            reason: error.message
          })
        );
      });

      child.on("exit", (code, signal) => {
        // Propagate the wrapped command's status. A signal-terminated child maps
        // to the conventional 128 + signal number.
        resolve(signal === null ? (code ?? 0) : 128 + signalNumber(signal));
      });
    });

    // Exit with the wrapped command's status. oclif's run loop catches the
    // thrown ExitError and exits the process with this code.
    return this.exit(status);
  }
}

/** Best-effort mapping of a termination signal name to its number. */
function signalNumber(signal: NodeJS.Signals): number {
  const known: Partial<Record<NodeJS.Signals, number>> = {
    SIGHUP: 1,
    SIGINT: 2,
    SIGQUIT: 3,
    SIGKILL: 9,
    SIGTERM: 15
  };
  return known[signal] ?? 1;
}
