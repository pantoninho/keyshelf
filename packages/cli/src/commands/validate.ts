import { Args } from "@oclif/core";
import { createAdapter } from "../adapters/registry.js";
import { BaseCommand } from "../base-command.js";
import { KeyshelfError } from "../errors.js";
import { listEnvironments, loadEnvironment } from "../loader.js";
import type { LoadedEnvironment } from "../model.js";
import { resolveEnvironment } from "../resolve.js";
import { parseTarget } from "../target.js";
import { validateEnvironment } from "../validate.js";

/** The structured outcome of validating one environment in whole-project mode. */
interface EnvironmentResult {
  environment: string;
  valid: boolean;
  error?: ReturnType<KeyshelfError["toJSON"]>;
}

interface SingleResult {
  shelf: string;
  environment: string;
  valid: true;
}

interface ProjectResult {
  valid: boolean;
  results: EnvironmentResult[];
}

/**
 * Fully verify one loaded environment: structural validation, then secret
 * *resolvability* — "valid means would run" (docs/reference.md "Testing"). Every
 * declared `!secret` is resolved through the provider's adapter; an unresolvable
 * secret (e.g. `SECRET_NOT_FOUND`) makes the environment invalid. Resolution is
 * the only step here that touches a backend; it never executes anything.
 */
async function verify(projectDir: string, loaded: LoadedEnvironment): Promise<void> {
  validateEnvironment(loaded);

  const { shelf, name } = loaded.environment;
  await resolveEnvironment(loaded, () => {
    const provider = loaded.config.providers[loaded.environment.provider];
    return createAdapter(provider, {
      projectDir,
      project: loaded.config.project,
      shelf,
      env: name
    });
  });
}

/** Verify one environment, returning the structured error if any. */
function checkOne(
  projectDir: string,
  shelf: string,
  env: string
): Promise<KeyshelfError | undefined> {
  return loadEnvironment(projectDir, shelf, env)
    .then(async (loaded) => {
      await verify(projectDir, loaded);
      return undefined;
    })
    .catch((error: unknown) => {
      if (error instanceof KeyshelfError) return error;
      throw error;
    });
}

/**
 * Run the closed-contract + presence checks against a project, executing
 * nothing. `keyshelf validate <shelf>/<env>` checks a single environment and
 * fails with that environment's first {@link KeyshelfError}. `keyshelf validate`
 * (no argument) checks every environment in the project and emits a
 * per-environment aggregate; it exits non-zero if any environment fails.
 *
 * "Valid means would run": besides the structural checks, every declared
 * `!secret` is resolved through its provider's adapter to verify resolvability —
 * an unresolvable secret makes the environment invalid. Nothing is executed.
 */
export default class Validate extends BaseCommand {
  static description =
    "Validate that environments conform to their schema and that declared secrets resolve.";

  static examples = ["<%= config.bin %> validate", "<%= config.bin %> validate web/staging"];

  static args = {
    target: Args.string({
      description:
        "The environment to validate as <shelf>/<env>. Omit to validate the whole project.",
      required: false
    })
  };

  async run(): Promise<SingleResult | ProjectResult> {
    const { args } = await this.parse(Validate);
    const cwd = process.cwd();

    if (args.target === undefined) {
      return this.validateProject(cwd);
    }

    return this.validateSingle(cwd, args.target);
  }

  private async validateSingle(cwd: string, target: string): Promise<SingleResult> {
    const { shelf, env } = parseTarget(target);
    const loaded = await loadEnvironment(cwd, shelf, env);
    await verify(cwd, loaded);

    const environment = `${shelf}/${env}`;
    if (!this.jsonEnabled()) {
      this.log(`${environment} is valid.`);
    }

    return { shelf, environment, valid: true };
  }

  private async validateProject(cwd: string): Promise<ProjectResult> {
    const refs = await listEnvironments(cwd);
    refs.sort((a, b) => `${a.shelf}/${a.env}`.localeCompare(`${b.shelf}/${b.env}`));

    const results: EnvironmentResult[] = [];
    for (const ref of refs) {
      const environment = `${ref.shelf}/${ref.env}`;
      const error = await checkOne(cwd, ref.shelf, ref.env);
      results.push(
        error ? { environment, valid: false, error: error.toJSON() } : { environment, valid: true }
      );
    }

    const valid = results.every((r) => r.valid);
    if (!this.jsonEnabled()) this.logResults(results);

    if (!valid) {
      // The whole-project outcome is an aggregate, not a single KeyshelfError,
      // so BaseCommand.catch can't render it. We let oclif print the aggregate
      // (the returned value, in --json mode) and signal failure via exit status
      // — exit status is success/failure only; granularity lives in each
      // result's error.code.
      process.exitCode = 1;
    }

    return { valid, results };
  }

  /** Print the human-readable per-environment lines (non-JSON mode only). */
  private logResults(results: EnvironmentResult[]): void {
    for (const r of results) {
      this.log(
        r.valid
          ? `ok    ${r.environment}`
          : `FAIL  ${r.environment}  [${r.error?.code}] ${r.error?.message}`
      );
    }
  }
}
