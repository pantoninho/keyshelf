import type { NormalizedConfig } from "../config/types.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { ProviderContext } from "../providers/types.js";
import type { AmbiguousAction, DeleteAction, Plan, RenameAction } from "./plan.js";

export interface ApplyContext {
  config: NormalizedConfig;
  registry: ProviderRegistry;
  rootDir: string;
}

export interface ApplyResult {
  renamesApplied: number;
  deletesApplied: number;
}

export class AmbiguousActionsError extends Error {
  readonly count: number;
  constructor(actions: AmbiguousAction[]) {
    super(buildAmbiguousMessage(actions));
    this.name = "AmbiguousActionsError";
    this.count = actions.length;
  }
}

// Name each renamed key and the orphan candidates it could not unambiguously
// map, and embed the movedFrom fix on the renamed record.
function buildAmbiguousMessage(actions: AmbiguousAction[]): string {
  const count = actions.length;
  const header =
    `Refusing to apply: plan contains ${count} ambiguous rename${count === 1 ? "" : "s"}. ` +
    `up cannot tell which orphan in storage maps to the renamed key — ` +
    `add movedFrom on the renamed record to disambiguate, then re-run.`;
  const details = actions.map((action) => {
    const orphans = action.candidates.map((candidate) => `"${candidate.keyPath}"`).join(", ");
    return `  "${action.desired.keyPath}": orphan candidates ${orphans} — set movedFrom to the one it was renamed from`;
  });
  return [header, ...details].join("\n");
}

// Thrown when copy succeeds but the new location does not validate. We do
// NOT call delete in this case, so the source bytes remain intact and a
// follow-up `up` will simply replan.
export class ApplyValidationError extends Error {
  readonly action: RenameAction;
  readonly envName: string | undefined;
  constructor(action: RenameAction, envName: string | undefined) {
    const envSuffix = envName === undefined ? "" : ` [${envName}]`;
    super(
      `Apply aborted: copied "${action.from.keyPath}" → "${action.to.keyPath}"${envSuffix}, ` +
        `but validate failed at the new location. Source is intact; investigate and re-run.`
    );
    this.name = "ApplyValidationError";
    this.action = action;
    this.envName = envName;
  }
}

// Execute a plan against provider storage. Sequential by design: failures are
// easier to reason about, and provider rate limits are real. Per-Rename order
// is copy → validate → delete; standalone Deletes run after all renames so a
// validate-fail can abort before any orphans are removed.
export async function applyPlan(ctx: ApplyContext, plan: Plan): Promise<ApplyResult> {
  const ambiguous = collectAmbiguous(plan);
  if (ambiguous.length > 0) throw new AmbiguousActionsError(ambiguous);

  let renamesApplied = 0;
  let deletesApplied = 0;

  for (const action of plan) {
    if (action.kind === "rename") {
      await applyRename(ctx, action);
      renamesApplied += 1;
    }
  }

  for (const action of plan) {
    if (action.kind === "delete") {
      await applyDelete(ctx, action);
      deletesApplied += 1;
    }
  }

  return { renamesApplied, deletesApplied };
}

function collectAmbiguous(plan: Plan): AmbiguousAction[] {
  return plan.filter((action): action is AmbiguousAction => action.kind === "ambiguous");
}

async function applyRename(ctx: ApplyContext, action: RenameAction): Promise<void> {
  const provider = ctx.registry.get(action.providerName);
  for (const envName of action.envBindings) {
    const fromCtx = buildCtx(ctx, action.providerParams, action.from.keyPath, envName);
    const toCtx = buildCtx(ctx, action.providerParams, action.to.keyPath, envName);
    await provider.copy(fromCtx, toCtx);
    const ok = await provider.validate(toCtx);
    if (!ok) throw new ApplyValidationError(action, envName);
    await provider.delete(fromCtx);
  }
}

async function applyDelete(ctx: ApplyContext, action: DeleteAction): Promise<void> {
  const provider = ctx.registry.get(action.providerName);
  const target = buildCtx(ctx, action.providerParams, action.keyPath, action.envName);
  await provider.delete(target);
}

function buildCtx(
  ctx: ApplyContext,
  providerParams: unknown,
  keyPath: string,
  envName: string | undefined
): ProviderContext {
  return {
    keyPath,
    envName,
    rootDir: ctx.rootDir,
    config: (providerParams ?? {}) as unknown as Record<string, unknown>,
    keyshelfName: ctx.config.name
  };
}
