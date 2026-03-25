import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { GcpSmProvider } from "../../../src/providers/gcp-sm.js";

function mockClient() {
  return {
    accessSecretVersion: vi.fn(),
    getSecret: vi.fn(),
    createSecret: vi.fn(),
    addSecretVersion: vi.fn()
  };
}

describe("GcpSmProvider", () => {
  let client: ReturnType<typeof mockClient>;
  let provider: GcpSmProvider;

  beforeEach(() => {
    client = mockClient();
    provider = new GcpSmProvider(client as unknown as SecretManagerServiceClient);
  });

  function ctx(keyPath: string, envName = "prod") {
    return { keyPath, envName, config: { project: "my-proj" } };
  }

  describe("secret ID derivation", () => {
    it("generates keyshelf__{env}__{path} format", async () => {
      client.accessSecretVersion.mockResolvedValue([{ payload: { data: Buffer.from("val") } }]);

      await provider.resolve(ctx("db/password", "staging"));

      expect(client.accessSecretVersion).toHaveBeenCalledWith({
        name: "projects/my-proj/secrets/keyshelf__staging__db__password/versions/latest"
      });
    });

    it("handles deeply nested paths", async () => {
      client.accessSecretVersion.mockResolvedValue([{ payload: { data: Buffer.from("val") } }]);

      await provider.resolve(ctx("services/api/db/password", "dev"));

      expect(client.accessSecretVersion).toHaveBeenCalledWith({
        name: "projects/my-proj/secrets/keyshelf__dev__services__api__db__password/versions/latest"
      });
    });
  });

  describe("resolve", () => {
    it("returns payload as string", async () => {
      client.accessSecretVersion.mockResolvedValue([
        { payload: { data: Buffer.from("supersecret") } }
      ]);

      const result = await provider.resolve(ctx("db/password"));
      expect(result).toBe("supersecret");
    });

    it("handles string payload", async () => {
      client.accessSecretVersion.mockResolvedValue([{ payload: { data: "string-payload" } }]);

      const result = await provider.resolve(ctx("db/password"));
      expect(result).toBe("string-payload");
    });

    it("throws when payload is empty", async () => {
      client.accessSecretVersion.mockResolvedValue([{ payload: { data: null } }]);

      await expect(provider.resolve(ctx("db/password"))).rejects.toThrow("has no payload");
    });

    it("throws when project is missing", async () => {
      await expect(provider.resolve({ keyPath: "k", envName: "dev", config: {} })).rejects.toThrow(
        'gcp provider requires "project"'
      );
    });
  });

  describe("validate", () => {
    it("returns true when secret exists", async () => {
      client.getSecret.mockResolvedValue([{}]);

      const result = await provider.validate(ctx("db/password"));
      expect(result).toBe(true);
      expect(client.getSecret).toHaveBeenCalledWith({
        name: "projects/my-proj/secrets/keyshelf__prod__db__password"
      });
    });

    it("returns false when secret does not exist", async () => {
      client.getSecret.mockRejectedValue(new Error("NOT_FOUND"));

      const result = await provider.validate(ctx("db/password"));
      expect(result).toBe(false);
    });
  });

  describe("set", () => {
    it("creates secret and adds version", async () => {
      client.createSecret.mockResolvedValue([{}]);
      client.addSecretVersion.mockResolvedValue([{}]);

      await provider.set(ctx("db/password"), "newsecret");

      expect(client.createSecret).toHaveBeenCalledWith({
        parent: "projects/my-proj",
        secretId: "keyshelf__prod__db__password",
        secret: { replication: { automatic: {} } }
      });
      expect(client.addSecretVersion).toHaveBeenCalledWith({
        parent: "projects/my-proj/secrets/keyshelf__prod__db__password",
        payload: { data: Buffer.from("newsecret", "utf-8") }
      });
    });

    it("handles already-existing secret gracefully", async () => {
      const alreadyExists = Object.assign(new Error("ALREADY_EXISTS"), {
        code: 6
      });
      client.createSecret.mockRejectedValue(alreadyExists);
      client.addSecretVersion.mockResolvedValue([{}]);

      await provider.set(ctx("db/password"), "updated");

      expect(client.addSecretVersion).toHaveBeenCalled();
    });

    it("rethrows non-ALREADY_EXISTS errors from createSecret", async () => {
      const permDenied = Object.assign(new Error("PERMISSION_DENIED"), {
        code: 7
      });
      client.createSecret.mockRejectedValue(permDenied);

      await expect(provider.set(ctx("db/password"), "val")).rejects.toThrow("PERMISSION_DENIED");
    });
  });
});
