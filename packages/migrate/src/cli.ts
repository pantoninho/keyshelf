import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Command } from "commander";
import { emitConfig } from "./emit.js";
import { loadV4Project } from "./load-v4.js";
import { normalizeProject, type NormalizedMigration, type ProviderRef } from "./normalize.js";
import { buildReport } from "./report.js";
import { formatGcpRows, hasGcpBindings, migrateGcpSecrets } from "./migrate-gcp.js";

interface YamlToTsOptions {
  out: string;
  dryRun?: boolean;
  force?: boolean;
}

interface ProjectNameOptions {
  dryRun?: boolean;
  deleteLegacy?: boolean;
}

const program = new Command();

program.name("keyshelf-migrate").description("Migrate keyshelf v4 projects to v5");

program
  .command("yaml-to-typescript")
  .description("Convert keyshelf.yaml + .keyshelf/*.yaml into a single keyshelf.config.ts")
  .option("--out <path>", "Output path", "keyshelf.config.ts")
  .option("--dry-run", "Write generated config to stdout instead of disk")
  .option("--force", "Overwrite the output file if it already exists")
  .action(async (options: YamlToTsOptions) => {
    try {
      await runYamlToTypescript(options);
    } catch (err) {
      console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  });

program
  .command("project-name")
  .description(
    "Re-namespace remote secret stores under the project name (no-op for age/sops; rewrites GCP secret ids)"
  )
  .option("--dry-run", "Report planned changes without writing to remote stores")
  .option("--delete-legacy", "Delete legacy un-namespaced secrets after copying (use with care)")
  .action(async (options: ProjectNameOptions) => {
    try {
      await runProjectName(options);
    } catch (err) {
      console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  });

await program.parseAsync(process.argv);

async function runYamlToTypescript(options: YamlToTsOptions): Promise<void> {
  const migration = await loadMigration();
  const outPath = resolve(process.cwd(), options.out);
  if (!options.dryRun && existsSync(outPath) && !options.force) {
    throw new Error(`${outPath} already exists. Re-run with --force to overwrite it.`);
  }

  const source = emitConfig(migration);
  const report = buildReport(migration);

  if (options.dryRun) {
    process.stdout.write(source);
    process.stderr.write(report);
    return;
  }

  await writeFile(outPath, source, "utf-8");
  process.stderr.write(report);
  process.stderr.write(`Wrote ${outPath}\n`);
}

async function runProjectName(options: ProjectNameOptions): Promise<void> {
  const migration = await loadMigration();
  const providers = collectProviders(migration);

  if (providers.size === 0) {
    process.stderr.write("No secret bindings found; nothing to migrate.\n");
    return;
  }

  for (const provider of providers) {
    await migrateProvider(provider, migration, options);
  }
}

async function migrateProvider(
  provider: ProviderRef["name"],
  migration: NormalizedMigration,
  options: ProjectNameOptions
): Promise<void> {
  switch (provider) {
    case "age":
    case "sops":
      process.stderr.write(
        `${provider}: no-op (secrets stay co-located with the project; no remote namespacing required).\n`
      );
      return;
    case "gcp":
      await runGcpMigration(migration, options);
      return;
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unsupported provider for project-name migration: ${String(exhaustive)}`);
    }
  }
}

async function runGcpMigration(
  migration: NormalizedMigration,
  options: ProjectNameOptions
): Promise<void> {
  if (!hasGcpBindings(migration)) return;

  process.stderr.write(
    "gcp: re-namespacing secret ids under the project name. v4 secrets are left in place unless --delete-legacy is set.\n"
  );
  const result = await migrateGcpSecrets(migration, {
    dryRun: options.dryRun,
    deleteLegacy: options.deleteLegacy
  });

  const formatted = formatGcpRows(result.rows);
  if (formatted.length > 0) {
    process.stderr.write(`${formatted}\n`);
  }
  if (result.hadError) {
    throw new Error(
      "GCP secret-id migration finished with errors (see rows above). Resolve the conflicts and re-run."
    );
  }
}

function collectProviders(migration: NormalizedMigration): Set<ProviderRef["name"]> {
  const providers = new Set<ProviderRef["name"]>();
  for (const record of migration.keys) {
    if (record.kind !== "secret") continue;
    if (record.default !== undefined) providers.add(record.default.name);
    for (const value of Object.values(record.values ?? {})) {
      providers.add(value.name);
    }
  }
  return providers;
}

async function loadMigration(): Promise<NormalizedMigration> {
  const project = await loadV4Project(process.cwd());
  return normalizeProject(project);
}
