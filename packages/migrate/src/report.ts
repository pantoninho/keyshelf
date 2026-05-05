import type { AppMapping } from "./load-v4.js";
import type { NormalizedMigration, NormalizedRecord, ProviderRef } from "./normalize.js";

export function buildReport(migration: NormalizedMigration): string {
  const configCount = migration.keys.filter((record) => record.kind === "config").length;
  const secretCount = migration.keys.filter((record) => record.kind === "secret").length;
  const lines: string[] = [
    `Migrated ${migration.keys.length} keys (${configCount} config, ${secretCount} secret) across ${migration.envs.length} envs.`,
    ""
  ];
  lines.push("Secret rebind commands:");
  const commands = buildRebindCommands(migration.keys, migration.envs);
  if (commands.length === 0) {
    lines.push("  (none)");
  } else {
    lines.push(...commands.map((command) => `  ${command}`));
  }

  lines.push("");
  lines.push("Review:");
  lines.push("  - groups: [] is a placeholder; add v5 groups manually if you use group filters.");
  lines.push("  - Secret values are not copied by this config migration.");
  lines.push(mappingReview(migration.appMapping));

  return `${lines.join("\n")}\n`;
}

function buildRebindCommands(records: NormalizedRecord[], envs: string[]): string[] {
  const commands: string[] = [];
  for (const record of records) {
    if (record.kind !== "secret") continue;
    for (const env of envs) {
      const provider = record.values?.[env] ?? record.default;
      if (provider === undefined) continue;
      commands.push(commandFor(record.path, env, provider));
    }
  }
  return commands;
}

function commandFor(path: string, env: string, provider: ProviderRef): string {
  return [
    "keyshelf set",
    "--env",
    shellArg(env),
    "--provider",
    shellArg(provider.name),
    shellArg(path)
  ].join(" ");
}

function mappingReview(appMapping: AppMapping[]): string {
  if (appMapping.length === 0) {
    return "  - No root .env.keyshelf file was found; app-level mappings may live in subdirectories.";
  }
  const templates = appMapping.filter((mapping) => mapping.template !== undefined).length;
  return `  - Root .env.keyshelf remains separate (${appMapping.length} mappings, ${templates} templates).`;
}

function shellArg(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}
