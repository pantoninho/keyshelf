import { ReconciliationPlan, SecretChange } from './types.js';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

/**
 * Render a reconciliation plan as a human-readable string.
 *
 * Uses ANSI color codes: green for additions, red for removals, cyan for copies.
 *
 * @param plan - The reconciliation plan to render
 * @returns Formatted string describing all planned changes
 */
export function renderPlan(plan: ReconciliationPlan): string {
    const lines: string[] = [];

    for (const envPlan of plan.environments) {
        lines.push(`Environment: ${envPlan.envName}`);
        if (envPlan.secretChanges.length === 0) {
            lines.push('  (no changes)');
        } else {
            for (const change of envPlan.secretChanges) {
                lines.push(renderChange(change));
            }
        }
    }

    return lines.join('\n');
}

function renderChange(change: SecretChange): string {
    switch (change.kind) {
        case 'add':
            return `${GREEN}  + secret  ${change.path}  (new)${RESET}`;
        case 'remove':
            return `${RED}  - secret  ${change.path}${RESET}`;
        case 'copy':
            return `${CYAN}  \u21bb secret  ${change.path}  (from ${change.sourceEnv})${RESET}`;
    }
}
