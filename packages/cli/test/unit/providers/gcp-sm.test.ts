import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { GcpSmProvider, GcpAuthError } from "../../../src/providers/gcp-sm.js";

function mockClient() {
  return {
    accessSecretVersion: vi.fn(),
    getSecret: vi.fn(),
    createSecret: vi.fn(),
    addSecretVersion: vi.fn(),
    listSecrets: vi.fn(),
    deleteSecret: vi.fn()
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
    it("generates keyshelf__{env}__{path} when keyshelfName is absent (v4 callers)", async () => {
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

    it("includes keyshelfName segment when provided", async () => {
      client.accessSecretVersion.mockResolvedValue([{ payload: { data: Buffer.from("val") } }]);

      await provider.resolve({
        keyPath: "db/password",
        envName: "staging",
        rootDir: "/tmp",
        config: { project: "my-proj" },
        keyshelfName: "myapp"
      });

      expect(client.accessSecretVersion).toHaveBeenCalledWith({
        name: "projects/my-proj/secrets/keyshelf__myapp__staging__db__password/versions/latest"
      });
    });

    it("omits env segment when envName is undefined (envless secret)", async () => {
      client.accessSecretVersion.mockResolvedValue([{ payload: { data: Buffer.from("val") } }]);

      await provider.resolve({
        keyPath: "github/token",
        envName: undefined,
        rootDir: "/tmp",
        config: { project: "my-proj" },
        keyshelfName: "myapp"
      });

      expect(client.accessSecretVersion).toHaveBeenCalledWith({
        name: "projects/my-proj/secrets/keyshelf__myapp__github__token/versions/latest"
      });
    });

    it("omits env segment when envName is empty string (legacy callers)", async () => {
      client.accessSecretVersion.mockResolvedValue([{ payload: { data: Buffer.from("val") } }]);

      await provider.resolve({
        keyPath: "github/token",
        envName: "",
        rootDir: "/tmp",
        config: { project: "my-proj" },
        keyshelfName: "myapp"
      });

      expect(client.accessSecretVersion).toHaveBeenCalledWith({
        name: "projects/my-proj/secrets/keyshelf__myapp__github__token/versions/latest"
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

  describe("list", () => {
    function listCtx(overrides: Record<string, unknown> = {}) {
      return {
        rootDir: "/tmp",
        config: { project: "my-proj" },
        keyshelfName: "myapp",
        envs: ["dev", "staging", "prod"],
        ...overrides
      };
    }

    function mockSecrets(ids: string[]) {
      client.listSecrets.mockResolvedValue([
        ids.map((id) => ({ name: `projects/my-proj/secrets/${id}` })),
        null,
        {}
      ]);
    }

    it("returns empty array when no secrets match prefix", async () => {
      mockSecrets(["unrelated-secret", "other__thing"]);
      expect(await provider.list(listCtx())).toEqual([]);
    });

    it("filters by keyshelfName prefix and parses env-scoped ids", async () => {
      mockSecrets([
        "keyshelf__myapp__staging__db__password",
        "keyshelf__myapp__prod__api__token",
        "keyshelf__otherapp__staging__db__password"
      ]);

      const result = await provider.list(listCtx());
      expect(result).toEqual(
        expect.arrayContaining([
          { keyPath: "db/password", envName: "staging" },
          { keyPath: "api/token", envName: "prod" }
        ])
      );
      expect(result).toHaveLength(2);
    });

    it("treats segments not in envs as part of key path (envless secrets)", async () => {
      mockSecrets(["keyshelf__myapp__github__token"]);
      const result = await provider.list(listCtx());
      expect(result).toEqual([{ keyPath: "github/token", envName: undefined }]);
    });

    it("handles missing keyshelfName (v4 callers)", async () => {
      mockSecrets(["keyshelf__staging__db__password", "keyshelf__github__token"]);
      const result = await provider.list(listCtx({ keyshelfName: undefined }));
      expect(result).toEqual(
        expect.arrayContaining([
          { keyPath: "db/password", envName: "staging" },
          { keyPath: "github/token", envName: undefined }
        ])
      );
    });

    it("requires project config", async () => {
      await expect(provider.list({ rootDir: "/tmp", config: {} })).rejects.toThrow(
        'gcp provider requires "project"'
      );
    });

    it("wraps auth errors as GcpAuthError", async () => {
      client.listSecrets.mockRejectedValue(
        Object.assign(new Error("UNAUTHENTICATED"), { code: 16 })
      );
      await expect(provider.list(listCtx())).rejects.toThrow(GcpAuthError);
    });
  });

  describe("copy", () => {
    function copyCtx(keyPath: string, envName: string | undefined = "prod") {
      return { keyPath, envName, rootDir: "/tmp", config: { project: "my-proj" } };
    }

    it("reads payload from source then creates target and adds version", async () => {
      client.accessSecretVersion.mockResolvedValue([
        { payload: { data: Buffer.from("payload-bytes") } }
      ]);
      client.createSecret.mockResolvedValue([{}]);
      client.addSecretVersion.mockResolvedValue([{}]);

      await provider.copy(copyCtx("old/key"), copyCtx("new/key"));

      expect(client.accessSecretVersion).toHaveBeenCalledWith({
        name: "projects/my-proj/secrets/keyshelf__prod__old__key/versions/latest"
      });
      expect(client.createSecret).toHaveBeenCalledWith({
        parent: "projects/my-proj",
        secretId: "keyshelf__prod__new__key",
        secret: { replication: { automatic: {} } }
      });
      expect(client.addSecretVersion).toHaveBeenCalledWith({
        parent: "projects/my-proj/secrets/keyshelf__prod__new__key",
        payload: { data: Buffer.from("payload-bytes") }
      });
      // copy must NOT delete the source — apply pipeline does that after validate.
      expect(client.deleteSecret).not.toHaveBeenCalled();
    });

    it("treats ALREADY_EXISTS on createSecret as recoverable (still adds version)", async () => {
      client.accessSecretVersion.mockResolvedValue([{ payload: { data: Buffer.from("v") } }]);
      client.createSecret.mockRejectedValue(
        Object.assign(new Error("ALREADY_EXISTS"), { code: 6 })
      );
      client.addSecretVersion.mockResolvedValue([{}]);

      await provider.copy(copyCtx("a"), copyCtx("b"));
      expect(client.addSecretVersion).toHaveBeenCalled();
    });

    it("rethrows non-recoverable createSecret errors", async () => {
      client.accessSecretVersion.mockResolvedValue([{ payload: { data: Buffer.from("v") } }]);
      client.createSecret.mockRejectedValue(
        Object.assign(new Error("PERMISSION_DENIED"), { code: 7 })
      );

      await expect(provider.copy(copyCtx("a"), copyCtx("b"))).rejects.toThrow("PERMISSION_DENIED");
    });

    it("throws when source has no payload", async () => {
      client.accessSecretVersion.mockResolvedValue([{ payload: { data: null } }]);
      await expect(provider.copy(copyCtx("a"), copyCtx("b"))).rejects.toThrow("has no payload");
    });

    it("wraps auth errors during accessSecretVersion as GcpAuthError", async () => {
      client.accessSecretVersion.mockRejectedValue(
        Object.assign(new Error("UNAUTHENTICATED"), { code: 16 })
      );
      await expect(provider.copy(copyCtx("a"), copyCtx("b"))).rejects.toThrow(GcpAuthError);
    });
  });

  describe("delete", () => {
    it("calls deleteSecret with the derived id", async () => {
      client.deleteSecret.mockResolvedValue([{}]);
      await provider.delete(ctx("legacy/key"));
      expect(client.deleteSecret).toHaveBeenCalledWith({
        name: "projects/my-proj/secrets/keyshelf__prod__legacy__key"
      });
    });

    it("is idempotent on NOT_FOUND (gRPC code 5)", async () => {
      client.deleteSecret.mockRejectedValue(Object.assign(new Error("NOT_FOUND"), { code: 5 }));
      await expect(provider.delete(ctx("ghost"))).resolves.toBeUndefined();
    });

    it("rethrows other errors", async () => {
      client.deleteSecret.mockRejectedValue(Object.assign(new Error("INTERNAL"), { code: 13 }));
      await expect(provider.delete(ctx("k"))).rejects.toThrow("INTERNAL");
    });

    it("wraps auth errors as GcpAuthError", async () => {
      client.deleteSecret.mockRejectedValue(
        Object.assign(new Error("UNAUTHENTICATED"), { code: 16 })
      );
      await expect(provider.delete(ctx("k"))).rejects.toThrow(GcpAuthError);
    });
  });
});
