import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAdapter } from "../../src/adapters/registry.js";
import { SopsAdapter } from "../../src/adapters/sops.js";
import { platformPackage, resolveSopsBinary } from "../../src/adapters/sops-binary.js";
import { KeyshelfError } from "../../src/errors.js";

const ORIGINAL = process.env.KEYSHELF_SOPS_BIN;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.KEYSHELF_SOPS_BIN;
  else process.env.KEYSHELF_SOPS_BIN = ORIGINAL;
});

describe("resolveSopsBinary", () => {
  it("surfaces ADAPTER_UNAVAILABLE when the override points at a nonexistent binary", () => {
    process.env.KEYSHELF_SOPS_BIN = "/definitely/not/a/real/sops/binary";
    let thrown: unknown;
    try {
      resolveSopsBinary();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(KeyshelfError);
    expect((thrown as KeyshelfError).code).toBe("ADAPTER_UNAVAILABLE");
    // Never a raw spawn error — a clear, structured message (ADR-0003).
    expect((thrown as KeyshelfError).message).toContain("does not exist");
  });

  it("names the per-platform optional-dependency package for this host", () => {
    expect(platformPackage()).toBe(`@keyshelf/sops-${process.platform}-${process.arch}`);
  });
});

describe("sops adapter binary resolution", () => {
  it("maps a missing/unusable sops binary to ADAPTER_UNAVAILABLE at write time", async () => {
    process.env.KEYSHELF_SOPS_BIN = "/definitely/not/a/real/sops/binary";
    const adapter = new SopsAdapter({
      storePath: path.join("/tmp", "x", "app", "staging.secrets.yaml"),
      cwd: "/tmp/x"
    });
    let thrown: unknown;
    try {
      await adapter.write("KEY", "value");
    } catch (error) {
      thrown = error;
    }

    expect((thrown as KeyshelfError).code).toBe("ADAPTER_UNAVAILABLE");
  });
});

describe("createAdapter sops branch", () => {
  it("builds a SopsAdapter with the per-environment store path", () => {
    const adapter = createAdapter(
      { adapter: "sops" },
      { projectDir: "/proj", project: "myapp", shelf: "web", stage: "staging" }
    );
    expect(adapter).toBeInstanceOf(SopsAdapter);
  });
});
