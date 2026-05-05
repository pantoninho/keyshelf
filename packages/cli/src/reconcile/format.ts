import type {
  Action,
  AmbiguousAction,
  CreateAction,
  DeleteAction,
  NoOpAction,
  Plan,
  RenameAction
} from "./plan.js";

// Terraform-style render for `keyshelf up --plan`. Pure: takes a plan and
// returns the text. Caller decides where to write it.
export function renderPlan(plan: Plan): string {
  const grouped = groupByKind(plan);
  if (countMutatingActions(plan) === 0) {
    const noopSuffix = grouped.noop.length > 0 ? ` (${grouped.noop.length} unchanged)` : "";
    return `No changes. Storage is in sync with the config.${noopSuffix}\n`;
  }

  const sections: string[] = [];

  if (grouped.rename.length > 0) sections.push(renderRenames(grouped.rename));
  if (grouped.create.length > 0) sections.push(renderCreates(grouped.create));
  if (grouped.delete.length > 0) sections.push(renderDeletes(grouped.delete));
  if (grouped.ambiguous.length > 0) sections.push(renderAmbiguous(grouped.ambiguous));

  const summary = renderSummary(grouped);
  return ["Plan:", "", ...sections, summary].join("\n");
}

interface GroupedActions {
  noop: NoOpAction[];
  create: CreateAction[];
  delete: DeleteAction[];
  rename: RenameAction[];
  ambiguous: AmbiguousAction[];
}

function groupByKind(plan: Plan): GroupedActions {
  const out: GroupedActions = {
    noop: [],
    create: [],
    delete: [],
    rename: [],
    ambiguous: []
  };
  for (const action of plan) {
    appendByKind(out, action);
  }
  return out;
}

function appendByKind(out: GroupedActions, action: Action): void {
  switch (action.kind) {
    case "noop":
      out.noop.push(action);
      return;
    case "create":
      out.create.push(action);
      return;
    case "delete":
      out.delete.push(action);
      return;
    case "rename":
      out.rename.push(action);
      return;
    case "ambiguous":
      out.ambiguous.push(action);
      return;
  }
}

function renderRenames(items: RenameAction[]): string {
  const lines: string[] = [];
  for (const r of items) {
    lines.push(`  ~ ${r.to.keyPath}   (renamed from ${r.from.keyPath})`);
    lines.push(`      provider: ${r.providerName}`);
    lines.push(`      envs: ${formatEnvBindings(r.envBindings)}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderCreates(items: CreateAction[]): string {
  const lines: string[] = [];
  for (const c of items) {
    lines.push(
      `  + ${c.keyPath}${formatEnvSuffix(c.envName)}   (new — run \`keyshelf set\` to populate)`
    );
    lines.push(`      provider: ${c.providerName}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderDeletes(items: DeleteAction[]): string {
  const lines: string[] = [];
  for (const d of items) {
    lines.push(
      `  - ${d.keyPath}${formatEnvSuffix(d.envName)}   (orphan; will be deleted on apply)`
    );
    lines.push(`      provider: ${d.providerName}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderAmbiguous(items: AmbiguousAction[]): string {
  const lines: string[] = [];
  for (const a of items) {
    lines.push(`  ? ${a.desired.keyPath}   (ambiguous rename)`);
    lines.push(`      provider: ${a.desired.providerName}`);
    lines.push(`      candidate orphans:`);
    for (const cand of a.candidates) {
      lines.push(`        - ${cand.keyPath}`);
    }
    lines.push(`      ${a.hint}`);
    lines.push(`      add one of:`);
    for (const cand of a.candidates) {
      lines.push(`        secret({ movedFrom: ${JSON.stringify(cand.keyPath)}, ... })`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function renderSummary(grouped: GroupedActions): string {
  const parts: string[] = [];
  if (grouped.create.length > 0) parts.push(`${grouped.create.length} to create`);
  if (grouped.rename.length > 0) parts.push(`${grouped.rename.length} to rename`);
  if (grouped.delete.length > 0) parts.push(`${grouped.delete.length} to delete`);
  if (grouped.ambiguous.length > 0) parts.push(`${grouped.ambiguous.length} ambiguous`);
  if (grouped.noop.length > 0) parts.push(`${grouped.noop.length} unchanged`);
  return `Summary: ${parts.join(", ")}\n`;
}

function formatEnvSuffix(envName: string | undefined): string {
  return envName === undefined ? "" : ` [${envName}]`;
}

function formatEnvBindings(envs: Array<string | undefined>): string {
  if (envs.length === 0) return "(envless)";
  return envs.map((e) => e ?? "(envless)").join(", ");
}

// Counts a plan's mutating actions (excludes noop). Used by the CLI to
// pick its exit code: 0 if zero mutating actions, 2 otherwise.
export function countMutatingActions(plan: Plan): number {
  let count = 0;
  for (const action of plan) {
    if (action.kind !== "noop") count += 1;
  }
  return count;
}
