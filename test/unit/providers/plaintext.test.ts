import { describe, it, expect } from "vitest";
import { PlaintextProvider } from "../../../src/providers/plaintext.js";

describe("PlaintextProvider", () => {
  const provider = new PlaintextProvider();

  it("resolves string value from config", async () => {
    const result = await provider.resolve({
      envName: "test",
      keyPath: "db/host",
      config: { value: "localhost" }
    });
    expect(result).toBe("localhost");
  });

  it("throws when value is not a string", async () => {
    await expect(provider.resolve({ keyPath: "db/host", config: {} })).rejects.toThrow(
      "Plaintext provider requires a string value"
    );
  });

  it("validates string values", async () => {
    expect(await provider.validate({ keyPath: "k", config: { value: "v" } })).toBe(true);
  });

  it("rejects non-string values", async () => {
    expect(await provider.validate({ keyPath: "k", config: {} })).toBe(false);
  });

  it("set is a no-op", async () => {
    await expect(provider.set({ keyPath: "k", config: {} }, "v")).resolves.toBeUndefined();
  });

  it("delete is a no-op", async () => {
    await expect(provider.delete({ keyPath: "k", config: {} })).resolves.toBeUndefined();
  });
});
