import { Command } from "commander";
import { loadConfig } from "../config/index.js";
import { createDefaultRegistry } from "../providers/setup.js";
import { gatherListings, type ListingFailure } from "../reconcile/listings.js";
import { planReconciliation } from "../reconcile/planner.js";
import { countMutatingActions, renderPlan } from "../reconcile/format.js";

interface UpOptions {
  plan?: boolean;
}

export const upCommand = new Command("up")
  .description("Reconcile config against provider storage (Phase 3: read-only --plan)")
  .option("--plan", "Show the reconciliation plan without mutating storage")
  .action(async (opts: UpOptions) => {
    // Phase 3 only ships read-only behavior. Whether or not --plan is passed,
    // `up` does not mutate storage. Phase 4 will add the apply path.
    void opts;
    await runPlan();
  });

async function runPlan(): Promise<void> {
  try {
    const exitCode = await computePlanExitCode();
    process.exit(exitCode);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`error: ${msg}`);
    process.exit(1);
  }
}

async function computePlanExitCode(): Promise<number> {
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

  return countMutatingActions(plan) === 0 ? 0 : 2;
}

function reportFailures(failures: ListingFailure[]): void {
  for (const f of failures) {
    console.error(`warning: skipped listing for provider "${f.providerName}" (${f.error.message})`);
  }
}
