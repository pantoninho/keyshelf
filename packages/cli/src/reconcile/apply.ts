import type { NormalizedConfig } from "../config/types.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { ProviderContext } from "../providers/types.js";
import type { DeleteAction, Plan, RenameAction } from "./plan.js";

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
  constructor(count: number) {
    super(
      `Refusing to apply: plan contains ${count} ambiguous action${count === 1 ? "" : "s"}. ` +
        `Add a movedFrom annotation to disambiguate, then re-run.`
    );
    this.name = "AmbiguousActionsError";
    this.count = count;
  }
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
  const ambiguousCount = countAmbiguous(plan);
  if (ambiguousCount > 0) throw new AmbiguousActionsError(ambiguousCount);

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

function countAmbiguous(plan: Plan): number {
  let n = 0;
  for (const a of plan) if (a.kind === "ambiguous") n += 1;
  return n;
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
