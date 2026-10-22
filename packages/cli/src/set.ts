import {
  Document,
  isMap,
  isNode,
  isScalar,
  isSeq,
  Pair,
  parseDocument,
  Scalar,
  YAMLMap
} from "yaml";
import type { KeyReference } from "./model.js";

/**
 * The form a `!secret` reference takes in the environment file. The adapter's
 * `write` returns the canonical stored name; when that name matches the
 * convention the adapter would resolve by default, the environment records a
 * *bare* `!secret` (the value lives in the store under the convention name).
 * Anything else — a foreign/explicit name, or a non-string payload — is recorded
 * verbatim as `!secret { ref: ... }` so it round-trips back through the loader.
 */
export type SecretRefForm =
  | { bare: true; version?: number }
  | { bare: false; ref: unknown; version?: number };

/**
 * Decide how to record a written secret's reference. `adapterRef` is whatever
 * `Adapter.write` returned (its `ref`); `conventionRef` is the name the
 * environment's adapter would resolve by convention for this key. They match (or
 * the adapter returned `undefined`) ⇒ a bare `!secret`; otherwise the foreign
 * reference is carried explicitly.
 *
 * `version` is the concrete backend version `write` reported (ADR-0009). When
 * present it is recorded as a pin (`!secret { version: N }` or
 * `!secret { ref: NAME, version: N }`); when `undefined` the reference floats
 * (resolves `latest`), as adapters that do not version their store report.
 */
export function secretRefForm(
  adapterRef: unknown,
  conventionRef: string,
  version?: string
): SecretRefForm {
  const pin = version === undefined ? {} : { version: Number.parseInt(version, 10) };
  if (adapterRef === undefined || adapterRef === conventionRef) {
    return { bare: true, ...pin };
  }

  return { bare: false, ref: adapterRef, ...pin };
}

/**
 * Find or create the top-level `keys:` mapping of an environment document,
 * mutating the document in place. Surgical: the `provider:` line, comments, and
 * every other key are left untouched.
 */
function keysMap(doc: Document): YAMLMap {
  const top = doc.contents;
  if (!isMap(top)) {
    // An environment with no mapping (or only a provider that parsed oddly) is a
    // caller bug here — the loader has already accepted the file as a mapping.
    throw new Error("environment document is not a mapping");
  }

  const existing = top.get("keys", true);
  if (isMap(existing)) {
    return existing;
  }

  const created = new YAMLMap();
  top.set("keys", created);
  return created;
}

/**
 * Set `KEY` to a plaintext value under `keys:`, in place. Overwrites any prior
 * value — including a prior `!secret` tag — with a plain scalar, and preserves
 * every other key and the `provider:` line. The value is stored as a string;
 * the `yaml` library quotes/escapes it as needed so adversarial values
 * (spaces, `=`, quotes, newlines) round-trip byte-exactly.
 */
export function setConfigValue(doc: Document, key: string, value: string): void {
  keysMap(doc).set(key, new Scalar(value));
}

/**
 * Record `KEY` as a `!secret` reference under `keys:`, in place — never the
 * value. A bare form writes a tagged null scalar (`KEY: !secret`); an explicit
 * form writes a tagged mapping (`KEY: !secret { ref: ... }`). Both parse back
 * through the loader's `!secret` handling.
 */
export function setSecretRef(doc: Document, key: string, form: SecretRefForm): void {
  const map = keysMap(doc);

  // A bare, floating !secret is a tagged null scalar; anything with a payload
  // (an explicit foreign ref and/or a pinned version, ADR-0009) is a tagged
  // mapping carrying only the fields the form supplies, in ref → version order.
  if (form.bare && form.version === undefined) {
    const scalar = new Scalar(null);
    scalar.tag = "!secret";
    // Force an empty plain representation so `yaml` emits the tag with no `null`
    // token (`!secret ` rather than `!secret null`), per issue #254. The yaml
    // serializer still hardcodes a single space between a tag and its (empty)
    // value, so the bare line lands as `!secret ` with one trailing space;
    // serializeEnvDoc() trims that to a clean bare `!secret`.
    scalar.source = "";
    scalar.type = Scalar.PLAIN;
    map.set(key, scalar);
    return;
  }

  const payload: Record<string, unknown> = {};
  if (!form.bare) payload.ref = form.ref;
  if (form.version !== undefined) payload.version = form.version;

  const node = doc.createNode(payload) as YAMLMap;
  node.tag = "!secret";
  map.set(key, node);
}

/**
 * Serialize an environment document to its on-disk YAML text. Use this instead
 * of `doc.toString()` for any document that may carry a bare `!secret`.
 *
 * The `yaml` serializer hardcodes a single space between a tag and its value
 * token, so a bare, value-less `!secret` (see {@link setSecretRef}) emits as
 * `KEY: !secret ` with one trailing space. This trims that lone trailing space
 * so a floating secret serializes as exactly `KEY: !secret` (issue #254).
 *
 * The pattern anchors on the `: !secret` tag immediately followed by spaces at
 * end of line (`(?=\r?$)`, so LF and CRLF both match, and a final line with no
 * trailing newline is handled too) — independent of the key, so unusual keys
 * (`API:KEY`, a quoted key with a space) are cleaned as well. Because it
 * requires the tag to be trailed only by spaces, payload forms
 * (`!secret`\n`    ref:`/`version:`), a tag followed by content (`!secret foo`),
 * and any string value that merely contains the text `!secret` (which `yaml`
 * quotes) are all left untouched.
 */
export function serializeEnvDoc(doc: Document): string {
  return doc.toString().replace(/(: !secret) +(?=\r?$)/gm, "$1");
}

/**
 * Serialize a single-key edit of an environment document as a *minimal textual
 * edit* of the file's original `source` (issue #270 b/c). `doc` is `source`
 * parsed and then mutated for exactly one `key` by {@link setConfigValue},
 * {@link setSecretRef} or {@link setKeyReference}.
 *
 * Re-serializing the whole document is lossy for text `set` was never asked to
 * touch: the `yaml` library rewrites every other bare `!secret` as `!secret ""`
 * and re-attaches comments that precede a key to the previous key's line. So
 * instead only the edited key's own span (from its key to the end of its value,
 * leaving any trailing comment in place) is replaced with a freshly rendered
 * `KEY: value`; a key new to the file is appended as a new line after the last
 * entry of `keys:`. Everything else — comments, blank lines, quoting, other keys
 * — stays byte-identical.
 *
 * Safety net: when the minimal edit is not possible (no block `keys:` mapping
 * yet, an unusual layout) or its result would not parse to the same content as
 * the full re-serialization, the full re-serialization ({@link serializeEnvDoc})
 * is written instead — lossy for formatting, never for content.
 */
export function serializeEnvEdit(source: string, doc: Document, key: string): string {
  const full = serializeEnvDoc(doc);
  const spliced = spliceKey(source, doc, key);
  if (spliced === undefined || !sameContent(spliced, full)) {
    return full;
  }

  return spliced;
}

/** The pair for `key` in a document's top-level `keys:` mapping, if any. */
function findKeyPair(contents: unknown, key: string): Pair | undefined {
  if (!isMap(contents)) return undefined;
  const keys = contents.get("keys", true);
  if (!isMap(keys)) return undefined;
  return keys.items.find(
    (pair) => pair.key === key || (isScalar(pair.key) && pair.key.value === key)
  ) as Pair | undefined;
}

/** Move `end` back over trailing whitespace (spaces, tabs, line breaks), not past `floor`. */
function trimEnd(source: string, end: number, floor: number): number {
  let at = end;
  while (at > floor && /[ \t\r\n]/.test(source[at - 1])) at--;
  return at;
}

/** The run of spaces between the start of `at`'s line and `at`, or `undefined` if not all spaces. */
function indentAt(source: string, at: number): string | undefined {
  const lineStart = source.lastIndexOf("\n", at - 1) + 1;
  const indent = source.slice(lineStart, at);
  return /^ *$/.test(indent) ? indent : undefined;
}

/**
 * Render `key: value` as a standalone block-mapping entry, its continuation lines
 * (a block `!secret`/`!ref` payload, a block scalar) shifted right by `indent` so
 * they nest under a key at that column. Returns the text without a trailing line
 * break, joined with `eol`.
 */
function renderPair(key: string, value: unknown, indent: string, eol: string): string {
  const one = new Document();
  const map = new YAMLMap();
  map.items.push(new Pair(new Scalar(key), value));
  one.contents = map;
  const lines = serializeEnvDoc(one)
    .replace(/\r?\n$/, "")
    .split(/\r?\n/);
  return lines.map((line, i) => (i === 0 || line === "" ? line : indent + line)).join(eol);
}

/**
 * Compute the minimal textual edit of `source` that applies the edited `key` of
 * `doc`, or `undefined` when the layout does not allow one (the caller then
 * falls back to a full re-serialization).
 */
function spliceKey(source: string, doc: Document, key: string): string | undefined {
  const edited = findKeyPair(doc.contents, key);
  if (edited === undefined || !isNode(edited.value)) return undefined;

  const original = parseDocument(source);
  if (original.errors.length > 0 || !isMap(original.contents)) return undefined;
  const keys = original.contents.get("keys", true);
  if (!isMap(keys) || keys.flow || keys.items.length === 0) return undefined;
  const eol = source.includes("\r\n") ? "\r\n" : "\n";

  const target = findKeyPair(original.contents, key);
  return target === undefined
    ? appendKey(source, keys.items[keys.items.length - 1], key, edited.value, eol)
    : replaceKey(source, target, key, edited.value, eol);
}

/**
 * Where a parsed pair sits in its source: the key's start offset, the end offset
 * of its value, and the indentation of its line. `undefined` when a node carries
 * no range or the key is not indented by spaces alone.
 */
function pairSpan(
  source: string,
  pair: Pair
): { start: number; valueEnd: number; indent: string } | undefined {
  if (!isNode(pair.key) || !isNode(pair.value)) return undefined;
  const start = pair.key.range?.[0];
  const valueEnd = pair.value.range?.[1];
  if (start === undefined || valueEnd === undefined) return undefined;
  const indent = indentAt(source, start);
  return indent === undefined ? undefined : { start, valueEnd, indent };
}

/**
 * Replace `target`'s span, from its key to the end of its value, with the edited
 * pair. Trailing whitespace is left in place so a same-line comment
 * (`KEY: !secret # note`) keeps its spacing.
 */
function replaceKey(
  source: string,
  target: Pair,
  key: string,
  edited: unknown,
  eol: string
): string | undefined {
  const span = pairSpan(source, target);
  if (span === undefined) return undefined;
  const end = trimEnd(source, span.valueEnd, span.start);
  const rendered = renderPair(key, keepFlow(target.value, edited), span.indent, eol);
  return source.slice(0, span.start) + rendered + source.slice(end);
}

/** Keep a one-line flow payload (`!secret { ref: NAME }`) on one line when it is rewritten. */
function keepFlow(previous: unknown, edited: unknown): unknown {
  if (!isMap(previous) || !previous.flow || !isMap(edited)) return edited;
  const flow = edited.clone();
  flow.flow = true;
  return flow;
}

/**
 * Append a key new to the file on its own line after `last`, the final entry of
 * `keys:`, at that entry's indentation.
 */
function appendKey(
  source: string,
  last: Pair,
  key: string,
  edited: unknown,
  eol: string
): string | undefined {
  const span = pairSpan(source, last);
  if (span === undefined) return undefined;
  const line = span.indent + renderPair(key, edited, span.indent, eol);
  const newline = source.indexOf("\n", trimEnd(source, span.valueEnd, span.start));
  if (newline === -1) {
    return source + eol + line;
  }

  return source.slice(0, newline + 1) + line + eol + source.slice(newline + 1);
}

/**
 * Whether two environment texts parse to the same content: the same mappings,
 * scalars and tags. The value of a scalar `!secret` is ignored (the loader reads
 * any scalar `!secret` as a bare secret, so `!secret` and `!secret ""` agree).
 */
function sameContent(a: string, b: string): boolean {
  const left = parseDocument(a);
  const right = parseDocument(b);
  if (left.errors.length > 0 || right.errors.length > 0) return false;
  return JSON.stringify(contentOf(left.contents)) === JSON.stringify(contentOf(right.contents));
}

/** A comment- and layout-free projection of a parsed node, for {@link sameContent}. */
function contentOf(node: unknown): unknown {
  if (node === null || node === undefined) return null;
  if (isScalar(node)) {
    return { tag: node.tag ?? null, value: node.tag === "!secret" ? null : node.value };
  }

  if (isMap(node)) {
    return {
      tag: node.tag ?? null,
      map: node.items.map((pair) => [contentOf(pair.key), contentOf(pair.value)])
    };
  }

  if (isSeq(node)) {
    return { tag: node.tag ?? null, seq: node.items.map((item) => contentOf(item)) };
  }

  return { other: String(node) };
}

/**
 * Record `KEY` as a `!ref` key reference under `keys:`, in place (ADR-0007) —
 * never a value. Writes a tagged mapping `KEY: !ref { shelf, [key], [stage] }`
 * that parses back through the loader's `!ref` handling. `shelf` is always
 * written; `key` and `stage` are written only when present on `reference`, so the
 * caller is responsible for omitting `key` when the target name equals the
 * consuming key (same-name is the loader's default) and `stage` for the current
 * stage. Overwrites any prior value, including a `!secret`, and preserves every
 * other key and the `provider:` line.
 */
export function setKeyReference(doc: Document, key: string, reference: KeyReference): void {
  // Build the payload in field order shelf → key → stage, omitting absent
  // optionals so the written node carries only what the author specified.
  const payload: Record<string, string> = { shelf: reference.shelf };
  if (reference.key !== undefined) payload.key = reference.key;
  if (reference.stage !== undefined) payload.stage = reference.stage;

  const node = doc.createNode(payload) as YAMLMap;
  node.tag = "!ref";
  keysMap(doc).set(key, node);
}
