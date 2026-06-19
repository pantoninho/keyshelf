import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { KeyshelfError } from "../errors.js";
import type { Adapter } from "./adapter.js";

/**
 * The store backing the {@link FakeAdapter}: a flat `storedName -> value` map.
 * It is BOTH the test double and the conformance fast lane (ADR-0005), so it
 * must behave faithfully — a missing entry is `SECRET_NOT_FOUND` and values
 * round-trip byte-exactly.
 *
 * Two flavours of backing exist. An in-memory store is enough for unit/contract
 * tests within one process. A file-backed store persists JSON to disk so that a
 * value written by one `keyshelf` process is resolvable by a *separate* process
 * later — the E2E suite spawns the real binary, so a `write` in one invocation
 * and a `resolve` in the next must see the same store.
 */
export interface FakeStore {
  read(name: string): string | undefined;
  put(name: string, value: string): void;
}

/** An in-memory store; lives only as long as the process that created it. */
export function inMemoryStore(seed: Record<string, string> = {}): FakeStore {
  const data = new Map<string, string>(Object.entries(seed));
  return {
    read: (name) => data.get(name),
    put: (name, value) => {
      data.set(name, value);
    }
  };
}

/**
 * A JSON-file-backed store. The file survives across separate CLI process
 * invocations, which is what lets the E2E suite write in one `keyshelf` run and
 * resolve in the next. Reads and writes are whole-file so concurrent processes
 * are not supported — fine for a test/dev adapter.
 */
export function fileStore(filePath: string): FakeStore {
  function load(): Record<string, string> {
    if (!existsSync(filePath)) return {};
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, string>;
      }
    } catch (error) {
      throw new KeyshelfError(
        "ADAPTER_ERROR",
        `Could not read fake store '${filePath}': ${String(error)}`,
        {
          file: filePath
        }
      );
    }

    return {};
  }

  return {
    read: (name) => load()[name],
    put: (name, value) => {
      const data = load();
      data[name] = value;
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    }
  };
}

/**
 * The in-memory `fake` adapter. A clearly test/dev-only {@link Adapter} that
 * implements the two-method contract against a {@link FakeStore}.
 *
 * Naming faithfully mirrors the reference-adapter convention
 * (`{project}-{shelf}-{env}-{key}`, docs/reference.md): the `namespace` is the
 * `{project}-{shelf}-{env}` prefix, so the same key in two environments stays
 * distinct in a shared store. A `!secret` resolves by convention (under the key's
 * composed name) unless an explicit `ref` string overrides it with a foreign
 * stored name.
 */
export class FakeAdapter implements Adapter {
  private readonly store: FakeStore;
  private readonly namespace: string;

  constructor(store: FakeStore, namespace = "") {
    this.store = store;
    this.namespace = namespace;
  }

  /** Compose the convention stored-name for a key: `{namespace}-{key}`. */
  private conventionName(key: string): string {
    return this.namespace === "" ? key : `${this.namespace}-${key}`;
  }

  async resolve(key: string, ref?: unknown): Promise<string> {
    const name = ref === undefined ? this.conventionName(key) : refName(ref);
    const value = this.store.read(name);
    if (value === undefined) {
      throw new KeyshelfError("SECRET_NOT_FOUND", `No secret stored for '${name}'.`, {
        key,
        ref: name
      });
    }

    return value;
  }

  async write(key: string, value: string): Promise<unknown> {
    const name = this.conventionName(key);
    this.store.put(name, value);
    // Return the canonical stored name so a foreign environment can reference
    // this value explicitly via `!secret { ref: <name> }`.
    return name;
  }
}

/** Coerce an explicit `!secret` ref payload to the stored name string. */
function refName(ref: unknown): string {
  if (typeof ref === "string") return ref;
  if (
    ref &&
    typeof ref === "object" &&
    "ref" in ref &&
    typeof (ref as { ref: unknown }).ref === "string"
  ) {
    return (ref as { ref: string }).ref;
  }

  throw new KeyshelfError(
    "ADAPTER_ERROR",
    `fake adapter: unsupported !secret ref payload: ${JSON.stringify(ref)}`,
    {
      ref
    }
  );
}
