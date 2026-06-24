import { Args, Flags, ux } from "@oclif/core";
import stringWidth from "string-width";
import { adapterForEnvironment } from "../adapters/registry.js";
import { BaseCommand } from "../base-command.js";
import { environmentKeyView, formatStatus, type KeyView } from "../env-view.js";
import { loadEnvironment, loadProjectMap, type ProjectMap } from "../loader.js";
import { parseTarget } from "../target.js";

/** Render an {@link KeyView.metadata} address as a single-line table cell. */
function metadataCell(view: KeyView): string {
  if (view.metadata === undefined) return "";
  return view.metadata.adapter === "gcp" ? view.metadata.resource : "";
}

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
 * `keyshelf ls` has two offline, value-free modes (ADR-0008). Both are pure
 * reads — they touch no backend and print no key value. The environment view may
 * build the environment's adapter, but only to compute a key's offline backend
 * **address** (never its value): adapter construction and `metadata()` are
 * synchronous and credential-free, so this stays offline.
 *
 * - `keyshelf ls` (no argument) prints a project map: every shelf, its schema's
 *   key count, and the environments under it, as a tree.
 * - `keyshelf ls <shelf>/<stage>` prints one environment's full schema contract:
 *   every declared key, in declaration order, annotated with its schema
 *   **presence** and this environment's **status** (`config` / `secret` /
 *   `ref → target` / `default` / `missing` / `unset`).
 *
 * Each secret key's offline backend address is carried in `--json` always, and
 * shown in the human table only behind `--metadata` (the default table stays
 * lean).
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
    "<%= config.bin %> ls backend/production --metadata",
    "<%= config.bin %> ls backend/production --json"
  ];

  static args = {
    target: Args.string({
      description: "An environment as <shelf>/<stage>. Omit to print the whole-project map.",
      required: false
    })
  };

  static flags = {
    metadata: Flags.boolean({
      description:
        "Show each secret key's offline backend address (e.g. its GCP Secret Manager resource) as an extra table column. Always present in --json.",
      default: false
    })
  };

  async run(): Promise<ProjectMapResult | EnvironmentViewResult> {
    const { args, flags } = await this.parse(Ls);
    const cwd = process.cwd();

    if (args.target === undefined) {
      return this.runProjectMap(cwd);
    }

    return this.runEnvironmentView(cwd, args.target, flags.metadata);
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
  private async runEnvironmentView(
    cwd: string,
    target: string,
    showMetadata: boolean
  ): Promise<EnvironmentViewResult> {
    const { shelf, stage } = parseTarget(target);
    const loaded = await loadEnvironment(cwd, shelf, stage);
    // Build the environment's adapter to compute offline secret addresses. This
    // stays offline and credential-free: construction never reaches the backend,
    // and metadata() is synchronous and network-free (ADR-0008). Adapter address
    // metadata is always carried in --json; the human table shows it only behind
    // --metadata.
    const adapter = adapterForEnvironment(cwd, loaded);
    const keys = environmentKeyView(loaded, adapter);

    if (!this.jsonEnabled()) {
      this.renderKeyTable(keys, showMetadata);
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

  /**
   * Print the borderless, column-aligned key table (non-JSON mode only). With
   * `showMetadata`, append a METADATA column carrying each secret key's offline
   * backend address (blank for keys with none); the default table omits it
   * entirely so it stays lean.
   */
  private renderKeyTable(keys: KeyView[], showMetadata: boolean): void {
    if (keys.length === 0) {
      this.log("No keys declared.");
      return;
    }

    const rows = keys.map((view) => ({
      key: view.key,
      presence: view.presence,
      status: formatStatus(view, (color, text) => ux.colorize(color, text)),
      metadata: metadataCell(view)
    }));

    // Column widths are measured on the *uncoloured* text (status here is plain,
    // including its glyph) so colour codes never count toward alignment.
    const keyWidth = columnWidth("KEY", rows, (r) => r.key);
    const presenceWidth = columnWidth("PRESENCE", rows, (r) => r.presence);

    if (!showMetadata) {
      this.log(
        `${ux.colorize("bold", pad("KEY", keyWidth))}   ${ux.colorize(
          "bold",
          pad("PRESENCE", presenceWidth)
        )}   ${ux.colorize("bold", "STATUS")}`
      );
      for (const row of rows) {
        this.log(`${pad(row.key, keyWidth)}   ${pad(row.presence, presenceWidth)}   ${row.status}`);
      }
      return;
    }

    // STATUS carries glyphs/colour, so pad it on its uncoloured display width to
    // keep the trailing METADATA column aligned.
    const statusWidth = columnWidth("STATUS", rows, (r) => r.status);
    this.log(
      `${ux.colorize("bold", pad("KEY", keyWidth))}   ${ux.colorize(
        "bold",
        pad("PRESENCE", presenceWidth)
      )}   ${ux.colorize("bold", pad("STATUS", statusWidth))}   ${ux.colorize("bold", "METADATA")}`
    );
    for (const row of rows) {
      this.log(
        `${pad(row.key, keyWidth)}   ${pad(row.presence, presenceWidth)}   ${pad(
          row.status,
          statusWidth
        )}   ${row.metadata}`
      );
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

/** Flatten the project map into the environment-centric `--json` shape. */
function toEnvironments(map: ProjectMap): EnvironmentEntry[] {
  return map.shelves.flatMap((shelf) =>
    shelf.stages.map((stage) => ({ shelf: shelf.shelf, stage, keys: shelf.keys }))
  );
}
