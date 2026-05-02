import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Command } from "commander";
import { emitConfig } from "./emit.js";
import { loadV4Project } from "./load-v4.js";
import { normalizeProject } from "./normalize.js";
import { buildReport } from "./report.js";

interface CliOptions {
  out: string;
  dryRun?: boolean;
  force?: boolean;
  acceptRenamedName?: boolean;
}

const program = new Command();

program
  .name("keyshelf-migrate")
  .description("Migrate keyshelf v4 YAML files to keyshelf.config.ts")
  .option("--out <path>", "Output path", "keyshelf.config.ts")
  .option("--dry-run", "Write generated config to stdout")
  .option("--force", "Overwrite the output file if it already exists")
  .option("--accept-renamed-name", "Accept converting v4 names with underscores to v5 kebab-case")
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
  const source = emitConfig(migration);
  const report = buildReport(migration);

  if (options.dryRun) {
    process.stdout.write(source);
    process.stderr.write(report);
    return;
  }

  const outPath = resolve(process.cwd(), options.out);
  if (existsSync(outPath) && !options.force) {
    throw new Error(`${outPath} already exists. Re-run with --force to overwrite it.`);
  }

  await writeFile(outPath, source, "utf-8");
  process.stderr.write(report);
  process.stderr.write(`Wrote ${outPath}\n`);
}
