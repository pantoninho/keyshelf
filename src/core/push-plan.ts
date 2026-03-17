/** A single change to be applied to a deploy target. */
export type EnvVarChange =
    | { kind: 'add'; key: string; sensitive: boolean }
    | { kind: 'update'; key: string; sensitive: boolean }
    | { kind: 'remove'; key: string };

/** A plan describing all changes needed to bring a target in sync with desired state. */
export interface PushPlan {
    targetName: string;
    changes: EnvVarChange[];
}

const KIND_ORDER: Record<EnvVarChange['kind'], number> = { add: 0, update: 1, remove: 2 };

/**
 * Compute the diff between desired env vars and what the target currently has.
 *
 * Keys in desired but not current → add. Keys in both but different value → update.
 * Keys in current but not desired → remove. Changes are sorted by kind then key.
 *
 * @param targetName - Name of the deploy target
 * @param desired - Desired state with values and sensitivity flags
 * @param current - Current platform state (key → value)
 * @returns A PushPlan with all changes needed
 */
export function buildPushPlan(
    targetName: string,
    desired: Record<string, { value: string; sensitive: boolean }>,
    current: Record<string, string>
): PushPlan {
    const changes: EnvVarChange[] = [];

    for (const [key, { value, sensitive }] of Object.entries(desired)) {
        if (!(key in current)) {
            changes.push({ kind: 'add', key, sensitive });
        } else if (current[key] !== value) {
            changes.push({ kind: 'update', key, sensitive });
        }
    }

    for (const key of Object.keys(current)) {
        if (!(key in desired)) {
            changes.push({ kind: 'remove', key });
        }
    }

    changes.sort((a, b) => {
        const kindDiff = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
        return kindDiff !== 0 ? kindDiff : a.key.localeCompare(b.key);
    });

    return { targetName, changes };
}

/**
 * Render a push plan as a human-readable string.
 *
 * Shows + for additions, ~ for updates, - for removals. Never shows values.
 * Sensitive keys are tagged with "(sensitive)".
 *
 * @param plan - The push plan to render
 * @returns Formatted string describing all planned changes
 */
export function renderPushPlan(plan: PushPlan): string {
    if (plan.changes.length === 0) return 'No changes.';

    const lines: string[] = [`Target: ${plan.targetName}`];

    for (const change of plan.changes) {
        lines.push(renderChange(change));
    }

    lines.push(buildSummaryLine(plan.changes));

    return lines.join('\n');
}

function renderChange(change: EnvVarChange): string {
    const sensitiveTag = change.kind !== 'remove' && change.sensitive ? ' (sensitive)' : '';

    switch (change.kind) {
        case 'add':
            return `  + ${change.key}${sensitiveTag}`;
        case 'update':
            return `  ~ ${change.key}${sensitiveTag}`;
        case 'remove':
            return `  - ${change.key}`;
    }
}

function buildSummaryLine(changes: EnvVarChange[]): string {
    const additions = changes.filter((c) => c.kind === 'add').length;
    const updates = changes.filter((c) => c.kind === 'update').length;
    const removals = changes.filter((c) => c.kind === 'remove').length;
    return `${additions} addition(s), ${updates} update(s), ${removals} removal(s)`;
}
