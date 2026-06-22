import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAdapter } from "../../src/adapters/registry.js";
import { KeyshelfError } from "../../src/errors.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "keyshelf-registry-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("createAdapter", () => {
  it("builds a fake adapter that round-trips through a persisted store", async () => {
    const ctx = { projectDir: dir, project: "myapp", shelf: "web", stage: "staging" };
    const a = createAdapter({ adapter: "fake" }, ctx);
    await a.write("DATABASE_PASSWORD", "sekret");

    // A second adapter instance (as a separate CLI process would build) sees it.
    const b = createAdapter({ adapter: "fake" }, ctx);
    expect(await b.resolve("DATABASE_PASSWORD")).toBe("sekret");
  });

  it("namespaces by project+stage so the same key in two environments is distinct", async () => {
    const staging = createAdapter(
      { adapter: "fake" },
      { projectDir: dir, project: "myapp", shelf: "web", stage: "staging" }
    );
    const prod = createAdapter(
      { adapter: "fake" },
      { projectDir: dir, project: "myapp", shelf: "web", stage: "prod" }
    );
    await staging.write("TOKEN", "staging-token");
    await prod.write("TOKEN", "prod-token");
    expect(await staging.resolve("TOKEN")).toBe("staging-token");
    expect(await prod.resolve("TOKEN")).toBe("prod-token");
  });

  it("rejects an unknown adapter name with a structured ADAPTER_UNAVAILABLE error", () => {
    let thrown: unknown;
    try {
      createAdapter(
        { adapter: "no-such-adapter" },
        { projectDir: dir, project: "myapp", shelf: "web", stage: "staging" }
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(KeyshelfError);
    expect((thrown as KeyshelfError).code).toBe("ADAPTER_UNAVAILABLE");
    expect((thrown as KeyshelfError).fields).toMatchObject({ adapter: "no-such-adapter" });
  });
});
