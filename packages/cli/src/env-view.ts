import type { Adapter, AdapterMetadata } from "./adapters/adapter.js";
import type { Environment, KeyReference, LoadedEnvironment, SchemaKey } from "./model.js";

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
  /**
   * The key's offline backend **address** (never its value), present only for
   * `secret` keys when the environment's adapter implements
   * {@link Adapter.metadata}. Computed without any network or credentials
   * (ADR-0008).
   */
  metadata?: AdapterMetadata;
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
 *
 * When an `adapter` is supplied and implements {@link Adapter.metadata}, each
 * `secret` key is annotated with its offline backend **address** (its storage
 * location, never its value — ADR-0008). `metadata()` is synchronous and
 * network-free, so this stays a pure, offline read. Only `secret` keys are
 * addressed: a `!ref` key resolves through its *target* environment's provider,
 * not this one's, so addressing it here would be misleading; config/default/
 * unset/missing keys have no backend storage at all.
 */
export function environmentKeyView(loaded: LoadedEnvironment, adapter?: Adapter): KeyView[] {
  const { schema, environment } = loaded;
  return Object.entries(schema.keys).map(([key, declared]) =>
    keyView(key, declared, environment, adapter)
  );
}

/** A key's schema presence requirement, derived from its declared kind. */
const PRESENCE_OF: Record<SchemaKey["kind"], Presence> = {
  config: "default",
  optional: "optional",
  required: "required"
};

/** The view of one declared key against the environment that may (or may not) supply it. */
function keyView(
  key: string,
  declared: SchemaKey,
  environment: Environment,
  adapter?: Adapter
): KeyView {
  const presence = PRESENCE_OF[declared.kind];
  const supplied = environment.keys[key];

  if (supplied === undefined) {
    // The environment omits the key; its status follows from schema presence.
    return { key, presence, status: absentStatus(declared.kind) };
  }

  if (supplied.kind === "ref" && supplied.reference !== undefined) {
    return {
      key,
      presence,
      status: "ref",
      reference: resolveReferenceCoordinates(key, supplied.reference, environment.name)
    };
  }

  if (supplied.kind === "secret") {
    // Address the secret offline through the environment's own adapter, if it can
    // (an adapter that can't compute an address without a network call omits
    // metadata() — ADR-0008). The explicit `!secret { ref }` payload, if any,
    // overrides the convention address.
    const metadata = adapter?.metadata?.(key, supplied.ref);
    return metadata === undefined
      ? { key, presence, status: "secret" }
      : { key, presence, status: "secret", metadata };
  }

  return { key, presence, status: "config" };
}

/** The status of a key the environment omits: default-backed, optional, or required. */
function absentStatus(kind: SchemaKey["kind"]): Status {
  if (kind === "config") return "default";
  if (kind === "optional") return "unset";
  return "missing";
}

/** Apply the `!ref` coordinate defaults (ADR-0007): stage → current stage, key → own name. */
function resolveReferenceCoordinates(
  consumingKey: string,
  reference: KeyReference,
  currentStage: string
): Required<KeyReference> {
  return {
    shelf: reference.shelf,
    stage: reference.stage ?? currentStage,
    key: reference.key ?? consumingKey
  };
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
