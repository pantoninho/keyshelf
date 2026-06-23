import type { KeyReference, LoadedEnvironment } from "./model.js";

/** A key's schema presence requirement, surfaced in the environment key view. */
export type Presence = "required" | "optional" | "default";

/**
 * How an environment fulfils a key (the raw status enum, glyph-free):
 * - `config` / `secret` / `ref` — the environment supplies the key,
 * - `default` — an unset config key resting on its schema default,
 * - `unset` — an optional key the environment omits,
 * - `missing` — a required key the environment omits.
 */
export type Status = "config" | "secret" | "ref" | "default" | "missing" | "unset";

/** One key in the environment view: its schema presence and this environment's status. */
export interface KeyView {
  key: string;
  presence: Presence;
  status: Status;
  /** Resolved `!ref` coordinates (defaults applied); present only for `ref` keys. */
  reference?: Required<KeyReference>;
}

/**
 * Build the full schema-contract view of one environment (ADR-0008): every key
 * the shelf's schema declares, in declaration order, annotated with its schema
 * **presence** and this environment's **status**.
 *
 * This is a pure read over the already-loaded model — it follows no `!ref` and
 * reaches no backend. For a `ref` key the `!ref` coordinate defaults are applied
 * (target stage → the current stage, target key → the consuming key's own name)
 * so the target is reported without the reference being followed. No key value is
 * read or returned.
 */
export function environmentKeyView(loaded: LoadedEnvironment): KeyView[] {
  const { schema, environment } = loaded;

  return Object.entries(schema.keys).map(([key, declared]) => {
    const supplied = environment.keys[key];

    if (supplied === undefined) {
      // The environment omits the key; its status follows from schema presence.
      if (declared.kind === "config") return { key, presence: "default", status: "default" };
      if (declared.kind === "optional") return { key, presence: "optional", status: "unset" };
      return { key, presence: "required", status: "missing" };
    }

    const presence: Presence =
      declared.kind === "config"
        ? "default"
        : declared.kind === "optional"
          ? "optional"
          : "required";

    if (supplied.kind === "ref" && supplied.reference !== undefined) {
      return {
        key,
        presence,
        status: "ref",
        reference: {
          shelf: supplied.reference.shelf,
          // Coordinate defaults (ADR-0007): stage → current stage, key → own name.
          stage: supplied.reference.stage ?? environment.name,
          key: supplied.reference.key ?? key
        }
      };
    }

    return { key, presence, status: supplied.kind === "secret" ? "secret" : "config" };
  });
}

/** A named colour applied to a span of status text. {@link ux.colorize}-compatible. */
export type StatusColor = "green" | "red" | "yellow" | "dim";

/** Apply a colour to a span of text; identity disables colour (e.g. for tests). */
export type Colorize = (color: StatusColor, text: string) => string;

/**
 * Render a key's STATUS as its `glyph word` display string, colour applied via
 * `colorize`. The glyph vocabulary is `✓` (supplied), `—` (resting on a default
 * / unset), `✗` (required but missing); `secret` is highlighted so sensitive keys
 * catch the eye and `ref` shows its resolved (but unfollowed) target. Pure — the
 * caller supplies `colorize` so colour is its concern (auto-off on non-TTY /
 * `NO_COLOR`), keeping this value-free and directly testable.
 */
export function formatStatus(view: KeyView, colorize: Colorize): string {
  const check = colorize("green", "✓");

  switch (view.status) {
    case "config":
      return `${check} config`;
    case "secret":
      return `${check} ${colorize("yellow", "secret")}`;
    case "ref":
      return `${check} ref → ${view.reference?.shelf}/${view.reference?.stage}`;
    case "default":
      return colorize("dim", "— default");
    case "unset":
      return colorize("dim", "— unset");
    case "missing":
      return `${colorize("red", "✗")} ${colorize("red", "missing")}`;
  }
}
