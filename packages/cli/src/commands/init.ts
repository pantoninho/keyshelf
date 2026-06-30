import { Flags } from "@oclif/core";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import { BaseCommand } from "../base-command.js";
import { KeyshelfError } from "../errors.js";
import { CONFIG_FILE, ENV_DIR, ROOT_DIR, SCHEMA_FILE } from "../paths.js";

/**
 * Scaffold a new Keyshelf project: a `.keyshelf/` directory holding `config.yaml`
 * (project name + a default `local` sops provider) and a starter shelf with an
 * empty `schema.yaml` and an empty reserved `environments/` folder (ADR-0011).
 * Non-interactive; refuses to clobber an existing project unless `--force` is given.
 */
export default class Init extends BaseCommand {
  static description = "Scaffold a new Keyshelf project in the current directory.";

  static examples = [
    "<%= config.bin %> init",
    "<%= config.bin %> init --project my-app --shelf web",
    "<%= config.bin %> init --force"
  ];

  static flags = {
    project: Flags.string({
      description: "Project name (defaults to the current directory name)."
    }),
    shelf: Flags.string({
      description: "Name of the starter shelf to create.",
      default: "app"
    }),
    force: Flags.boolean({
      description: "Overwrite an existing Keyshelf project.",
      default: false
    })
  };

  async run(): Promise<{ project: string; shelf: string; path: string; created: string[] }> {
    const { flags } = await this.parse(Init);

    const cwd = process.cwd();
    const root = path.join(cwd, ROOT_DIR);
    const configPath = path.join(root, CONFIG_FILE);
    const project = flags.project ?? path.basename(cwd);
    const { shelf } = flags;

    if (existsSync(configPath) && !flags.force) {
      throw new KeyshelfError(
        "ALREADY_INITIALIZED",
        `A Keyshelf project already exists at ${configPath}. Pass --force to overwrite.`,
        { path: configPath }
      );
    }

    const shelfDir = path.join(root, shelf);
    await mkdir(path.join(shelfDir, ENV_DIR), { recursive: true });

    await writeFile(
      configPath,
      stringify({ project, providers: { local: { adapter: "sops" } } }),
      "utf8"
    );
    await writeFile(path.join(shelfDir, SCHEMA_FILE), stringify({ keys: {} }), "utf8");

    const created = [CONFIG_FILE, `${shelf}/${SCHEMA_FILE}`, `${shelf}/${ENV_DIR}/`];
    if (!this.jsonEnabled()) {
      this.log(`Initialized Keyshelf project '${project}' with shelf '${shelf}'.`);
    }

    return { project, shelf, path: root, created };
  }
}
