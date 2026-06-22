import { Args } from "@oclif/core";
import { resolveDepsFor } from "../adapters/registry.js";
import { BaseCommand } from "../base-command.js";
import { KeyshelfError } from "../errors.js";
import { listEnvironments, loadEnvironment } from "../loader.js";
import type { LoadedEnvironment } from "../model.js";
import { resolveEnvironment } from "../resolve.js";
import { parseTarget } from "../target.js";
import { validateEnvironment, validateReferences } from "../validate.js";

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
 * Fully verify one loaded environment, in three escalating stages:
 *
 * 1. **Structural** — the closed-contract + presence checks ({@link
 *    validateEnvironment}), pure, no I/O.
 * 2. **Reference** — static, offline validation of every `!ref` ({@link
 *    validateReferences}): the target shelf/stage/key exist, are supplied, and
 *    land one hop on config or secret. Reaches the filesystem to load target
 *    schemas/environments, but touches **no backend** (ADR-0007, issue #203), so
 *    a dangling or chained reference fails before any provider is built.
 * 3. **Resolvability** — every declared `!secret` is resolved through its
 *    provider's adapter ("valid means would run", docs/reference.md "Testing");
 *    an unresolvable secret makes the environment invalid. This is the only stage
 *    that touches a backend; nothing is ever executed.
 */
async function verify(projectDir: string, loaded: LoadedEnvironment): Promise<void> {
  validateEnvironment(loaded);

  await validateReferences(loaded, {
    loadReference: (shelf, stage) => loadEnvironment(projectDir, shelf, stage)
  });

  // References were just proven sound offline; resolve only confirms LOCAL
  // secret resolvability here, never following a !ref into a backend.
  await resolveEnvironment(loaded, resolveDepsFor(projectDir), { references: "static" });
}

/** Verify one environment, returning the structured error if any. */
function checkOne(
  projectDir: string,
  shelf: string,
  stage: string
): Promise<KeyshelfError | undefined> {
  return loadEnvironment(projectDir, shelf, stage)
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
 * nothing. `keyshelf validate <shelf>/<stage>` checks a single environment and
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
        "The environment to validate as <shelf>/<stage>. Omit to validate the whole project.",
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
    const { shelf, stage } = parseTarget(target);
    const loaded = await loadEnvironment(cwd, shelf, stage);
    await verify(cwd, loaded);

    const environment = `${shelf}/${stage}`;
    if (!this.jsonEnabled()) {
      this.log(`${environment} is valid.`);
    }

    return { shelf, environment, valid: true };
  }

  private async validateProject(cwd: string): Promise<ProjectResult> {
    const refs = await listEnvironments(cwd);
    refs.sort((a, b) => `${a.shelf}/${a.stage}`.localeCompare(`${b.shelf}/${b.stage}`));

    const results: EnvironmentResult[] = [];
    for (const ref of refs) {
      const environment = `${ref.shelf}/${ref.stage}`;
      const error = await checkOne(cwd, ref.shelf, ref.stage);
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
