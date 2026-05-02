import { describe, expect, it } from "vitest";
import { emitConfig } from "../src/emit.js";
import { loadFixture } from "./test-utils.js";

describe("emitConfig", () => {
  it.each(["basic", "multi-env", "optional", "nested", "name-rename"])(
    "emits stable v5 config for %s",
    async (fixture) => {
      const migration = await loadFixture(fixture, { acceptRenamedName: true });
      expect(emitConfig(migration)).toMatchSnapshot();
    }
  );
});
