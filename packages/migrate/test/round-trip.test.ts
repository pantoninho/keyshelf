import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { emitConfig } from "../src/emit.js";
import { loadFixture } from "./test-utils.js";

const V5_CONFIG_MODULE = resolve("../cli/src/v5/config/index.ts");
const V5_LOADER_MODULE = `file://${resolve("../cli/src/v5/config/loader.ts")}`;

describe("round-trip through the v5 loader", () => {
  const roots: string[] = [];

  afterEach(async () => {
    delete process.env.KEYSHELF_CONFIG_MODULE_PATH;
    vi.resetModules();
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  it.each(["basic", "multi-env", "optional", "nested", "name-rename"])(
    "loads emitted %s config",
    async (fixture) => {
      const migration = await loadFixture(fixture, { acceptRenamedName: true });
      const root = await mkdtemp(join(tmpdir(), `keyshelf-migrate-roundtrip-${fixture}-`));
      roots.push(root);
      await writeFile(join(root, "keyshelf.config.ts"), emitConfig(migration), "utf-8");

      process.env.KEYSHELF_CONFIG_MODULE_PATH = V5_CONFIG_MODULE;
      const { loadV5Config } = (await import(V5_LOADER_MODULE)) as {
        loadV5Config(root: string): Promise<{
          config: {
            name: string;
            envs: string[];
            groups: string[];
            keys: Array<{
              path: string;
              kind: string;
              optional: boolean;
              value?: unknown;
              values?: Record<string, unknown>;
            }>;
          };
        }>;
      };
      const loaded = await loadV5Config(root);

      expect({
        ...loaded.config,
        keys: loaded.config.keys.map((record) => ({
          path: record.path,
          kind: record.kind,
          optional: record.optional,
          ...(record.value !== undefined ? { default: stripProviderKind(record.value) } : {}),
          ...(record.values !== undefined ? { values: stripProviderKinds(record.values) } : {})
        }))
      }).toEqual({
        name: migration.name,
        envs: migration.envs,
        groups: [],
        keys: migration.keys
      });
    }
  );
});

function stripProviderKinds(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([env, value]) => [env, stripProviderKind(value)])
  );
}

function stripProviderKind(value: unknown): unknown {
  if (value == null || typeof value !== "object" || !("__kind" in value)) return value;
  const rest = { ...(value as Record<string, unknown>) };
  delete rest.__kind;
  return rest;
}
