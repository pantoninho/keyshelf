import { ux } from "@oclif/core";
import { BaseCommand } from "../base-command.js";
import { loadProjectMap, type ProjectMap } from "../loader.js";

/** One environment in the flat, environment-centric `--json` shape. */
interface EnvironmentEntry {
  shelf: string;
  stage: string;
  keys: number;
}

/** The machine result: every environment, with its shelf's contract size. */
interface LsResult {
  environments: EnvironmentEntry[];
}

/**
 * `keyshelf ls` (no argument) prints an offline map of the project: every shelf,
 * its schema's key count, and the environments under it (ADR-0008). It is a pure
 * file read — it builds no provider, touches no backend, and prints no key values.
 *
 * Human output is a tree: each shelf is a node labelled with its contract size,
 * and its environments are leaves beneath it. Shelves and environment leaves are
 * each sorted alphabetically. Colour is applied semantically via {@link
 * ux.colorize} (bold shelf names, dimmed counts) and auto-disables on a non-TTY
 * and when `NO_COLOR` is set. `--json` returns the environment-centric shape,
 * consistent with `validate --json`.
 */
export default class Ls extends BaseCommand {
  static description =
    "Print an offline map of the project: every shelf, its key count, and its environments.";

  static aliases = ["list"];

  static examples = ["<%= config.bin %> ls", "<%= config.bin %> ls --json"];

  async run(): Promise<LsResult> {
    const map = await loadProjectMap(process.cwd());

    if (!this.jsonEnabled()) {
      this.renderTree(map);
    }

    return { environments: toEnvironments(map) };
  }

  /** Print the shelf/environment tree (non-JSON mode only). */
  private renderTree(map: ProjectMap): void {
    if (map.shelves.length === 0) {
      this.log("No shelves yet. Add one under .keyshelf/.");
      return;
    }

    for (const shelf of map.shelves) {
      const name = ux.colorize("bold", shelf.shelf);
      const count = ux.colorize("dim", `(${shelf.keys} keys)`);
      this.log(`${name} ${count}`);

      shelf.stages.forEach((stage, index) => {
        const connector = index === shelf.stages.length - 1 ? "└─" : "├─";
        this.log(`${connector} ${stage}`);
      });
    }
  }
}

/** Flatten the project map into the environment-centric `--json` shape. */
function toEnvironments(map: ProjectMap): EnvironmentEntry[] {
  return map.shelves.flatMap((shelf) =>
    shelf.stages.map((stage) => ({ shelf: shelf.shelf, stage, keys: shelf.keys }))
  );
}
