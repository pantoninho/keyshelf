import { Args, ux } from "@oclif/core";
import stringWidth from "string-width";
import { BaseCommand } from "../base-command.js";
import { environmentKeyView, type KeyView } from "../env-view.js";
import { loadEnvironment, loadProjectMap, type ProjectMap } from "../loader.js";
import { parseTarget } from "../target.js";

/** One environment in the flat, environment-centric `--json` shape. */
interface EnvironmentEntry {
  shelf: string;
  stage: string;
  keys: number;
}

/** The machine result of the project-map mode: every environment, with its shelf's contract size. */
interface ProjectMapResult {
  environments: EnvironmentEntry[];
}

/** The machine result of the environment-view mode: one environment's key contract. */
interface EnvironmentViewResult {
  shelf: string;
  stage: string;
  keys: KeyView[];
}

/**
 * `keyshelf ls` has two offline, value-free modes (ADR-0008). Both are pure file
 * reads — neither builds a provider, touches a backend, nor prints a key value.
 *
 * - `keyshelf ls` (no argument) prints a project map: every shelf, its schema's
 *   key count, and the environments under it, as a tree.
 * - `keyshelf ls <shelf>/<stage>` prints one environment's full schema contract:
 *   every declared key, in declaration order, annotated with its schema
 *   **presence** and this environment's **status** (`config` / `secret` /
 *   `ref → target` / `default` / `missing` / `unset`).
 *
 * Colour is applied semantically via {@link ux.colorize} and auto-disables on a
 * non-TTY and when `NO_COLOR` is set. Column alignment uses `string-width` so the
 * `✓` / `—` / `✗` glyphs do not break it. `--json` returns the project-map shape
 * (no argument) or the key-centric shape (with argument).
 */
export default class Ls extends BaseCommand {
  static description =
    "Print an offline map of the project, or one environment's key contract with <shelf>/<stage>.";

  static aliases = ["list"];

  static examples = [
    "<%= config.bin %> ls",
    "<%= config.bin %> ls --json",
    "<%= config.bin %> ls backend/production",
    "<%= config.bin %> ls backend/production --json"
  ];

  static args = {
    target: Args.string({
      description: "An environment as <shelf>/<stage>. Omit to print the whole-project map.",
      required: false
    })
  };

  async run(): Promise<ProjectMapResult | EnvironmentViewResult> {
    const { args } = await this.parse(Ls);
    const cwd = process.cwd();

    if (args.target === undefined) {
      return this.runProjectMap(cwd);
    }

    return this.runEnvironmentView(cwd, args.target);
  }

  /** `keyshelf ls` — the whole-project map. */
  private async runProjectMap(cwd: string): Promise<ProjectMapResult> {
    const map = await loadProjectMap(cwd);

    if (!this.jsonEnabled()) {
      this.renderTree(map);
    }

    return { environments: toEnvironments(map) };
  }

  /** `keyshelf ls <shelf>/<stage>` — one environment's key contract. */
  private async runEnvironmentView(cwd: string, target: string): Promise<EnvironmentViewResult> {
    const { shelf, stage } = parseTarget(target);
    const loaded = await loadEnvironment(cwd, shelf, stage);
    const keys = environmentKeyView(loaded);

    if (!this.jsonEnabled()) {
      this.renderKeyTable(keys);
    }

    return { shelf, stage, keys };
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

  /** Print the borderless, column-aligned key table (non-JSON mode only). */
  private renderKeyTable(keys: KeyView[]): void {
    if (keys.length === 0) {
      this.log("No keys declared.");
      return;
    }

    const rows = keys.map((view) => ({
      key: view.key,
      presence: view.presence,
      status: renderStatus(view)
    }));

    // Column widths are measured on the *uncoloured* text (status here is plain,
    // including its glyph) so colour codes never count toward alignment.
    const keyWidth = columnWidth("KEY", rows, (r) => r.key);
    const presenceWidth = columnWidth("PRESENCE", rows, (r) => r.presence);

    this.log(
      `${ux.colorize("bold", pad("KEY", keyWidth))}   ${ux.colorize(
        "bold",
        pad("PRESENCE", presenceWidth)
      )}   ${ux.colorize("bold", "STATUS")}`
    );

    for (const row of rows) {
      this.log(`${pad(row.key, keyWidth)}   ${pad(row.presence, presenceWidth)}   ${row.status}`);
    }
  }
}

/** The widest display width across a header and a column's cells. */
function columnWidth<T>(header: string, rows: T[], cell: (row: T) => string): number {
  return rows.reduce((max, row) => Math.max(max, stringWidth(cell(row))), stringWidth(header));
}

/** Right-pad `text` with spaces to a target display width (width-aware). */
function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - stringWidth(text)));
}

/**
 * The coloured `glyph word` for a key's status. The glyph vocabulary is
 * `✓` (supplied), `—` (resting on a default / unset), `✗` (required but missing).
 * `secret` is highlighted so sensitive keys catch the eye; `ref` shows its
 * resolved target. Colour auto-disables via {@link ux.colorize}.
 */
function renderStatus(view: KeyView): string {
  switch (view.status) {
    case "config":
      return `${ux.colorize("green", "✓")} config`;
    case "secret":
      return `${ux.colorize("green", "✓")} ${ux.colorize("yellow", "secret")}`;
    case "ref": {
      const target = `${view.reference?.shelf}/${view.reference?.stage}`;
      return `${ux.colorize("green", "✓")} ref → ${target}`;
    }
    case "default":
      return ux.colorize("dim", "— default");
    case "unset":
      return ux.colorize("dim", "— unset");
    case "missing":
      return `${ux.colorize("red", "✗")} ${ux.colorize("red", "missing")}`;
  }
}

/** Flatten the project map into the environment-centric `--json` shape. */
function toEnvironments(map: ProjectMap): EnvironmentEntry[] {
  return map.shelves.flatMap((shelf) =>
    shelf.stages.map((stage) => ({ shelf: shelf.shelf, stage, keys: shelf.keys }))
  );
}
