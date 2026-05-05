import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { loadConfig } from "../config/index.js";
import { createDefaultRegistry } from "../providers/setup.js";
import { ProviderRegistry } from "../providers/registry.js";
import {
  AmbiguousActionsError,
  ApplyValidationError,
  applyPlan,
  type ApplyResult
} from "../reconcile/apply.js";
import { gatherListings, type ListingFailure } from "../reconcile/listings.js";
import { planReconciliation } from "../reconcile/planner.js";
import { countMutatingActions, renderPlan } from "../reconcile/format.js";
import type { Plan } from "../reconcile/plan.js";
import type { NormalizedConfig } from "../config/types.js";

interface UpOptions {
  plan?: boolean;
  yes?: boolean;
}

export const upCommand = new Command("up")
  .description("Reconcile config against provider storage (plan + apply)")
  .option("--plan", "Show the reconciliation plan without mutating storage")
  .option("--yes", "Skip the confirmation prompt and apply immediately")
  .action(async (opts: UpOptions) => {
    try {
      const exitCode = await runUp(opts);
      process.exit(exitCode);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`error: ${msg}`);
      process.exit(1);
    }
  });

async function runUp(opts: UpOptions): Promise<number> {
  const loaded = await loadConfig(process.cwd());
  const registry = createDefaultRegistry();

  const { listings, failures } = await gatherListings({
    config: loaded.config,
    registry,
    rootDir: loaded.rootDir
  });
  reportFailures(failures);

  const plan = planReconciliation(loaded.config, listings);
  process.stdout.write(renderPlan(plan));

  // --plan: read-only drift-check.
  if (opts.plan) {
    return countMutatingActions(plan) === 0 ? 0 : 2;
  }

  if (countMutatingActions(plan) === 0) return 0;

  // Apply path. Refuse on Ambiguous before prompting so the user sees the
  // message immediately rather than after typing 'y'.
  if (planHasAmbiguous(plan)) {
    console.error(
      "error: cannot apply — plan contains ambiguous actions. " +
        "Add a movedFrom annotation on each ambiguous key, then re-run."
    );
    return 1;
  }

  if (!opts.yes) {
    const confirmed = await confirm("\nApply these changes? [y/N] ");
    if (!confirmed) {
      process.stdout.write("Apply cancelled.\n");
      return 0;
    }
  }

  return runApply(plan, loaded.config, registry, loaded.rootDir);
}

async function runApply(
  plan: Plan,
  config: NormalizedConfig,
  registry: ProviderRegistry,
  rootDir: string
): Promise<number> {
  try {
    const result = await applyPlan({ config, registry, rootDir }, plan);
    process.stdout.write(`\n${formatApplySummary(result)}\n`);
    return 0;
  } catch (err) {
    if (err instanceof AmbiguousActionsError || err instanceof ApplyValidationError) {
      console.error(`error: ${err.message}`);
      return 1;
    }
    throw err;
  }
}

function planHasAmbiguous(plan: Plan): boolean {
  for (const a of plan) if (a.kind === "ambiguous") return true;
  return false;
}

function formatApplySummary(result: ApplyResult): string {
  const parts: string[] = [];
  if (result.renamesApplied > 0) {
    parts.push(`${result.renamesApplied} rename${result.renamesApplied === 1 ? "" : "s"}`);
  }
  if (result.deletesApplied > 0) {
    parts.push(`${result.deletesApplied} delete${result.deletesApplied === 1 ? "" : "s"}`);
  }
  if (parts.length === 0) parts.push("no changes");
  return `Applied: ${parts.join(", ")}.`;
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(prompt);
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  } finally {
    rl.close();
  }
}

function reportFailures(failures: ListingFailure[]): void {
  for (const f of failures) {
    console.error(`warning: skipped listing for provider "${f.providerName}" (${f.error.message})`);
  }
}
