import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { generateKeyPair, ageProvider } from "@/providers/age";
import type { ProviderContext } from "@/types";

const TEST_PROJECT = `keyshelf-test-${Date.now()}`;

afterAll(async () => {
  const projectDir = join(homedir(), ".config", "keyshelf", TEST_PROJECT);
  await rm(projectDir, { recursive: true, force: true });
});

describe("ageProvider", () => {
  let context: ProviderContext;

  beforeAll(async () => {
    const publicKey = await generateKeyPair(TEST_PROJECT);
    context = {
      projectName: TEST_PROJECT,
      publicKey,
      keyPath: "test/secret",
      env: "default",
    };
  });

  it("encrypts and decrypts a value (round-trip)", async () => {
    const plaintext = "super-secret-value-123";
    const encrypted = await ageProvider.set!(plaintext, context);
    const decrypted = await ageProvider.get(encrypted, context);
    expect(decrypted).toBe(plaintext);
  });

  it("handles multi-line values", async () => {
    const plaintext = "line1\nline2\nline3";
    const encrypted = await ageProvider.set!(plaintext, context);
    const decrypted = await ageProvider.get(encrypted, context);
    expect(decrypted).toBe(plaintext);
  });

  it("throws when publicKey is missing on set", async () => {
    const noKeyCtx = { ...context, publicKey: undefined };
    await expect(ageProvider.set!("value", noKeyCtx)).rejects.toThrow(
      "No publicKey"
    );
  });

  it("throws when private key file does not exist", async () => {
    const missingKeyCtx: ProviderContext = {
      ...context,
      projectName: "keyshelf-nonexistent-project-that-has-no-key",
    };
    const encrypted = await ageProvider.set!("value", context);
    await expect(ageProvider.get(encrypted, missingKeyCtx)).rejects.toThrow(
      "Private key not found"
    );
  });

  it("encrypts and decrypts an empty string (round-trip)", async () => {
    const plaintext = "";
    const encrypted = await ageProvider.set!(plaintext, context);
    const decrypted = await ageProvider.get(encrypted, context);
    expect(decrypted).toBe(plaintext);
  });
});
