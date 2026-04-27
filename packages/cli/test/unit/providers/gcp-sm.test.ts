import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { GcpSmProvider, GcpAuthError } from "../../../src/providers/gcp-sm.js";

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
    return { keyPath, envName, rootDir: "/tmp", config: { project: "my-proj" } };
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
      await expect(
        provider.resolve({ keyPath: "k", envName: "dev", rootDir: "/tmp", config: {} })
      ).rejects.toThrow('gcp provider requires "project"');
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

  describe("auth error detection", () => {
    it("throws GcpAuthError on invalid_grant in resolve", async () => {
      const authErr = new Error(
        '400 undefined: Getting metadata from plugin failed with error: {"error":"invalid_grant","error_description":"reauth related error (invalid_rapt)"}'
      );
      client.accessSecretVersion.mockRejectedValue(authErr);

      await expect(provider.resolve(ctx("db/password"))).rejects.toThrow(GcpAuthError);
      await expect(provider.resolve(ctx("db/password"))).rejects.toThrow(
        "gcloud auth application-default login"
      );
    });

    it("throws GcpAuthError on UNAUTHENTICATED gRPC code in resolve", async () => {
      const authErr = Object.assign(new Error("UNAUTHENTICATED"), { code: 16 });
      client.accessSecretVersion.mockRejectedValue(authErr);

      await expect(provider.resolve(ctx("db/password"))).rejects.toThrow(GcpAuthError);
    });

    it("throws GcpAuthError on expired token in resolve", async () => {
      const authErr = new Error("token has been expired or revoked");
      client.accessSecretVersion.mockRejectedValue(authErr);

      await expect(provider.resolve(ctx("db/password"))).rejects.toThrow(GcpAuthError);
    });

    it("throws GcpAuthError on auth error in validate", async () => {
      const authErr = new Error(
        '{"error":"invalid_grant","error_description":"reauth related error (invalid_rapt)"}'
      );
      client.getSecret.mockRejectedValue(authErr);

      await expect(provider.validate(ctx("db/password"))).rejects.toThrow(GcpAuthError);
    });

    it("throws GcpAuthError on auth error in set (createSecret)", async () => {
      const authErr = new Error("invalid_grant");
      client.createSecret.mockRejectedValue(authErr);

      await expect(provider.set(ctx("db/password"), "val")).rejects.toThrow(GcpAuthError);
    });

    it("throws GcpAuthError on auth error in set (addSecretVersion)", async () => {
      client.createSecret.mockResolvedValue([{}]);
      const authErr = new Error("token has been expired or revoked");
      client.addSecretVersion.mockRejectedValue(authErr);

      await expect(provider.set(ctx("db/password"), "val")).rejects.toThrow(GcpAuthError);
    });

    it("throws GcpAuthError when default credentials not found", async () => {
      const authErr = new Error("Could not load the default credentials");
      client.accessSecretVersion.mockRejectedValue(authErr);

      await expect(provider.resolve(ctx("db/password"))).rejects.toThrow(GcpAuthError);
    });

    it("does not throw GcpAuthError for non-auth errors", async () => {
      const notFound = new Error("NOT_FOUND: Secret not found");
      client.accessSecretVersion.mockRejectedValue(notFound);

      await expect(provider.resolve(ctx("db/password"))).rejects.toThrow("NOT_FOUND");
      await expect(provider.resolve(ctx("db/password"))).rejects.not.toThrow(GcpAuthError);
    });
  });
});
