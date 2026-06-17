import { Command } from "commander";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { upsertKeyshelfSection } from "../init/agents-md.js";
import { buildConfigTemplate } from "../init/config-template.js";

const CONFIG_FILE = "keyshelf.config.ts";
const AGENTS_FILE = "AGENTS.md";

export const initCommand = new Command("init")
  .description(
    "Scaffold a starter keyshelf.config.ts and an AGENTS.md keyshelf section (idempotent, non-destructive)"
  )
  .action(async () => {
    try {
      await runInit(process.cwd());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`error: ${msg}`);
      process.exit(1);
    }
  });

async function runInit(rootDir: string): Promise<void> {
  await scaffoldConfig(rootDir);
  await scaffoldAgentsMd(rootDir);
}

async function scaffoldConfig(rootDir: string): Promise<void> {
  const configPath = join(rootDir, CONFIG_FILE);
  if (existsSync(configPath)) {
    console.log(`skip: ${CONFIG_FILE} already exists (left untouched)`);
    return;
  }
  await writeFile(configPath, buildConfigTemplate());
  console.log(`created: ${CONFIG_FILE}`);
}

async function scaffoldAgentsMd(rootDir: string): Promise<void> {
  const agentsPath = join(rootDir, AGENTS_FILE);
  const existing = existsSync(agentsPath) ? await readFile(agentsPath, "utf-8") : undefined;
  const updated = upsertKeyshelfSection(existing);

  if (existing === updated) {
    console.log(`skip: ${AGENTS_FILE} keyshelf section already up to date`);
    return;
  }

  await writeFile(agentsPath, updated);
  console.log(existing === undefined ? `created: ${AGENTS_FILE}` : `updated: ${AGENTS_FILE}`);
}
