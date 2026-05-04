import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Command } from "commander";
import { emitConfig } from "./emit.js";
import { loadV4Project } from "./load-v4.js";
import { normalizeProject, type NormalizedMigration } from "./normalize.js";
import { buildReport } from "./report.js";
import { formatGcpRows, hasGcpBindings, migrateGcpSecrets } from "./migrate-gcp.js";

interface CliOptions {
  out: string;
  dryRun?: boolean;
  force?: boolean;
  acceptRenamedName?: boolean;
  skipGcp?: boolean;
  deleteLegacyGcp?: boolean;
}

const program = new Command();

program
  .name("keyshelf-migrate")
  .description("Migrate keyshelf v4 YAML files to keyshelf.config.ts")
  .option("--out <path>", "Output path", "keyshelf.config.ts")
  .option("--dry-run", "Write generated config to stdout (also dry-runs GCP secret-id migration)")
  .option("--force", "Overwrite the output file if it already exists")
  .option("--accept-renamed-name", "Accept converting v4 names with underscores to v5 kebab-case")
  .option(
    "--skip-gcp",
    "Skip the GCP secret-id namespacing step (use only if you have already migrated or are not using gcp)"
  )
  .option(
    "--delete-legacy-gcp",
    "Delete legacy un-namespaced GCP secrets after copying (use with care)"
  )
  .action(async (options: CliOptions) => {
    try {
      await run(options);
    } catch (err) {
      console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  });

await program.parseAsync(process.argv);

async function run(options: CliOptions): Promise<void> {
  const project = await loadV4Project(process.cwd());
  const migration = normalizeProject(project, {
    acceptRenamedName: options.acceptRenamedName
  });

  if (!options.dryRun) {
    const outPath = resolve(process.cwd(), options.out);
    if (existsSync(outPath) && !options.force) {
      throw new Error(`${outPath} already exists. Re-run with --force to overwrite it.`);
    }
  }

  await runGcpStep(migration, options);

  const source = emitConfig(migration);
  const report = buildReport(migration);

  if (options.dryRun) {
    process.stdout.write(source);
    process.stderr.write(report);
    return;
  }

  const outPath = resolve(process.cwd(), options.out);
  await writeFile(outPath, source, "utf-8");
  process.stderr.write(report);
  process.stderr.write(`Wrote ${outPath}\n`);
}

async function runGcpStep(migration: NormalizedMigration, options: CliOptions): Promise<void> {
  if (options.skipGcp) return;
  if (!hasGcpBindings(migration)) return;

  process.stderr.write(
    "Migrating GCP secret ids to be namespaced by config name (this runs before keyshelf.config.ts is written so v4 stays usable on failure).\n"
  );
  const result = await migrateGcpSecrets(migration, {
    dryRun: options.dryRun,
    deleteLegacy: options.deleteLegacyGcp
  });

  const formatted = formatGcpRows(result.rows);
  if (formatted.length > 0) {
    process.stderr.write(`${formatted}\n`);
  }
  if (result.hadError) {
    throw new Error(
      "GCP secret-id migration finished with errors (see rows above). Resolve the conflicts or re-run with a different --out, then re-run keyshelf-migrate. v4 keyshelf.yaml was left untouched."
    );
  }
}
