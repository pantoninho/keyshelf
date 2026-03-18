import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "node:path";
import { createPulumiProvider, parseReference } from "@/providers/pulumi";
import type { ProviderContext } from "@/types";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

import { spawnSync } from "node:child_process";

const mockSpawnSync = vi.mocked(spawnSync);

beforeEach(() => {
  mockSpawnSync.mockReset();
});

const context: ProviderContext = {
  projectName: "my-project",
  env: "production",
  keyPath: "database/url",
};

describe("parseReference", () => {
  it("parses stack.outputName correctly", () => {
    expect(parseReference("dev.dbUrl")).toEqual({ stack: "dev", outputName: "dbUrl" });
  });

  it("handles dots in output name", () => {
    expect(parseReference("prod.nested.output")).toEqual({ stack: "prod", outputName: "nested.output" });
  });

  it("throws on missing dot", () => {
    expect(() => parseReference("nodot")).toThrow("Expected format: 'stack.outputName'");
  });

  it("throws on leading dot", () => {
    expect(() => parseReference(".outputOnly")).toThrow("Expected format: 'stack.outputName'");
  });

  it("throws on trailing dot", () => {
    expect(() => parseReference("stackOnly.")).toThrow("Expected format: 'stack.outputName'");
  });
});

describe("createPulumiProvider", () => {
  const provider = createPulumiProvider("./infra");

  function mockSuccess(stdout: string) {
    mockSpawnSync.mockReturnValueOnce({
      status: 0,
      stdout,
      stderr: "",
      pid: 0,
      output: [],
      signal: null,
    });
  }

  function mockFailure(stderr: string) {
    mockSpawnSync.mockReturnValueOnce({
      status: 1,
      stdout: "",
      stderr,
      pid: 0,
      output: [],
      signal: null,
    });
  }

  it("calls pulumi CLI with correct arguments", async () => {
    mockSuccess('"my-secret-value"\n');

    const result = await provider.get("dev.dbUrl", context);

    expect(result).toBe("my-secret-value");
    expect(mockSpawnSync).toHaveBeenCalledWith(
      "pulumi",
      ["stack", "output", "dbUrl", "--json", "--show-secrets", "-s", "dev", "-C", resolve("./infra")],
      expect.objectContaining({ encoding: "utf-8" })
    );
  });

  it("handles output names with dots", async () => {
    mockSuccess('"value"\n');

    await provider.get("dev.nested.output", context);

    expect(mockSpawnSync).toHaveBeenCalledWith(
      "pulumi",
      expect.arrayContaining(["nested.output"]),
      expect.anything()
    );
  });

  it("throws when output is not a string", async () => {
    mockSuccess("42\n");

    await expect(provider.get("dev.count", context)).rejects.toThrow("is not a string");
  });

  it("throws with stderr when CLI fails", async () => {
    mockFailure("error: stack 'dev' not found");

    await expect(provider.get("dev.dbUrl", context)).rejects.toThrow(
      "stack 'dev' not found"
    );
  });

  it("throws with exit code when CLI fails without stderr", async () => {
    mockFailure("");

    await expect(provider.get("dev.dbUrl", context)).rejects.toThrow(
      "pulumi exited with code 1"
    );
  });
});
