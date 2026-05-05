import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
  GetSecretValueCommand,
  ListSecretsCommand,
  PutSecretValueCommand,
  ResourceExistsException,
  ResourceNotFoundException,
  type SecretsManagerClient
} from "@aws-sdk/client-secrets-manager";
import { AwsAuthError, AwsRegionError, AwsSmProvider } from "../../../src/providers/aws-sm.js";

interface MockClient {
  send: ReturnType<typeof vi.fn>;
}

function mockClient(): MockClient {
  return { send: vi.fn() };
}

function commandKind(command: unknown): string {
  return (command as { constructor: { name: string } }).constructor.name;
}

function notFoundError(): ResourceNotFoundException {
  return new ResourceNotFoundException({
    $metadata: {},
    message: "Secrets Manager can't find the specified secret."
  });
}

function alreadyExistsError(): ResourceExistsException {
  return new ResourceExistsException({
    $metadata: {},
    message: "The operation failed because the secret already exists."
  });
}

function authError(name = "CredentialsProviderError"): Error {
  const err = new Error("Could not load credentials from any providers");
  err.name = name;
  return err;
}

function http403Error(): Error {
  const err = Object.assign(new Error("AccessDenied"), {
    name: "AccessDenied",
    $metadata: { httpStatusCode: 403 }
  });
  return err;
}

function regionMissingError(): Error {
  return new Error("Region is missing");
}

describe("AwsSmProvider", () => {
  let client: MockClient;
  let provider: AwsSmProvider;

  beforeEach(() => {
    client = mockClient();
    provider = new AwsSmProvider(client as unknown as SecretsManagerClient);
  });

  function ctx(keyPath: string, envName: string | undefined = "prod") {
    return { keyPath, envName, rootDir: "/tmp", config: { region: "eu-west-1" } };
  }

  describe("secret ID derivation", () => {
    it("generates keyshelf/{env}/{path} when keyshelfName is absent", async () => {
      client.send.mockResolvedValue({ SecretString: "val" });

      await provider.resolve(ctx("db/password", "staging"));

      const call = client.send.mock.calls[0][0];
      expect(commandKind(call)).toBe("GetSecretValueCommand");
      expect(call.input).toEqual({ SecretId: "keyshelf/staging/db/password" });
    });

    it("preserves nested path segments with /", async () => {
      client.send.mockResolvedValue({ SecretString: "val" });
      await provider.resolve(ctx("services/api/db/password", "dev"));
      expect(client.send.mock.calls[0][0].input.SecretId).toBe(
        "keyshelf/dev/services/api/db/password"
      );
    });

    it("includes keyshelfName segment when provided", async () => {
      client.send.mockResolvedValue({ SecretString: "val" });
      await provider.resolve({
        keyPath: "db/password",
        envName: "staging",
        rootDir: "/tmp",
        config: { region: "eu-west-1" },
        keyshelfName: "myapp"
      });
      expect(client.send.mock.calls[0][0].input.SecretId).toBe(
        "keyshelf/myapp/staging/db/password"
      );
    });

    it("omits env segment when envName is undefined (envless)", async () => {
      client.send.mockResolvedValue({ SecretString: "val" });
      await provider.resolve({
        keyPath: "github/token",
        envName: undefined,
        rootDir: "/tmp",
        config: { region: "eu-west-1" },
        keyshelfName: "myapp"
      });
      expect(client.send.mock.calls[0][0].input.SecretId).toBe("keyshelf/myapp/github/token");
    });

    it("omits env segment when envName is empty string", async () => {
      client.send.mockResolvedValue({ SecretString: "val" });
      await provider.resolve({
        keyPath: "github/token",
        envName: "",
        rootDir: "/tmp",
        config: { region: "eu-west-1" },
        keyshelfName: "myapp"
      });
      expect(client.send.mock.calls[0][0].input.SecretId).toBe("keyshelf/myapp/github/token");
    });
  });

  describe("resolve", () => {
    it("returns SecretString payload", async () => {
      client.send.mockResolvedValue({ SecretString: "supersecret" });
      const result = await provider.resolve(ctx("db/password"));
      expect(result).toBe("supersecret");
    });

    it("decodes SecretBinary as UTF-8 when SecretString is empty", async () => {
      client.send.mockResolvedValue({
        SecretString: "",
        SecretBinary: new Uint8Array(Buffer.from("binary-payload", "utf-8"))
      });
      const result = await provider.resolve(ctx("db/password"));
      expect(result).toBe("binary-payload");
    });

    it("throws when payload is empty", async () => {
      client.send.mockResolvedValue({});
      await expect(provider.resolve(ctx("db/password"))).rejects.toThrow("has no payload");
    });

    it("uses GetSecretValueCommand", async () => {
      client.send.mockResolvedValue({ SecretString: "v" });
      await provider.resolve(ctx("db/password"));
      expect(client.send.mock.calls[0][0]).toBeInstanceOf(GetSecretValueCommand);
    });
  });

  describe("validate", () => {
    it("returns true when DescribeSecret succeeds", async () => {
      client.send.mockResolvedValue({});
      const result = await provider.validate(ctx("db/password"));
      expect(result).toBe(true);
      expect(client.send.mock.calls[0][0]).toBeInstanceOf(DescribeSecretCommand);
    });

    it("returns false on ResourceNotFoundException", async () => {
      client.send.mockRejectedValue(notFoundError());
      expect(await provider.validate(ctx("db/password"))).toBe(false);
    });

    it("returns false on other errors", async () => {
      client.send.mockRejectedValue(new Error("InternalServiceError"));
      expect(await provider.validate(ctx("db/password"))).toBe(false);
    });

    it("throws AwsAuthError on auth failure", async () => {
      client.send.mockRejectedValue(authError());
      await expect(provider.validate(ctx("db/password"))).rejects.toThrow(AwsAuthError);
    });
  });

  describe("set", () => {
    it("uses CreateSecretCommand on first set", async () => {
      client.send.mockResolvedValue({});
      await provider.set(ctx("db/password"), "newval");

      expect(client.send.mock.calls).toHaveLength(1);
      const call = client.send.mock.calls[0][0];
      expect(call).toBeInstanceOf(CreateSecretCommand);
      expect(call.input).toEqual({
        Name: "keyshelf/prod/db/password",
        SecretString: "newval"
      });
    });

    it("forwards kmsKeyId on CreateSecret when configured", async () => {
      client.send.mockResolvedValue({});
      await provider.set(
        {
          keyPath: "db/password",
          envName: "prod",
          rootDir: "/tmp",
          config: { region: "eu-west-1", kmsKeyId: "arn:aws:kms:eu-west-1:111:key/abc" }
        },
        "v"
      );
      expect(client.send.mock.calls[0][0].input.KmsKeyId).toBe("arn:aws:kms:eu-west-1:111:key/abc");
    });

    it("falls back to PutSecretValueCommand on ResourceExistsException", async () => {
      client.send.mockRejectedValueOnce(alreadyExistsError()).mockResolvedValueOnce({});

      await provider.set(ctx("db/password"), "updated");

      expect(client.send.mock.calls).toHaveLength(2);
      expect(client.send.mock.calls[0][0]).toBeInstanceOf(CreateSecretCommand);
      const put = client.send.mock.calls[1][0];
      expect(put).toBeInstanceOf(PutSecretValueCommand);
      expect(put.input).toEqual({
        SecretId: "keyshelf/prod/db/password",
        SecretString: "updated"
      });
    });

    it("does not forward kmsKeyId on PutSecretValue (inherited from existing secret)", async () => {
      client.send.mockRejectedValueOnce(alreadyExistsError()).mockResolvedValueOnce({});
      await provider.set(
        {
          keyPath: "db/password",
          envName: "prod",
          rootDir: "/tmp",
          config: { region: "eu-west-1", kmsKeyId: "arn:aws:kms:eu-west-1:111:key/abc" }
        },
        "v"
      );
      expect(client.send.mock.calls[1][0].input.KmsKeyId).toBeUndefined();
    });

    it("rethrows non-recoverable errors from CreateSecret", async () => {
      const err = Object.assign(new Error("InvalidRequestException"), {
        name: "InvalidRequestException"
      });
      client.send.mockRejectedValue(err);
      await expect(provider.set(ctx("db/password"), "v")).rejects.toThrow(
        "InvalidRequestException"
      );
    });

    it("wraps auth errors on CreateSecret", async () => {
      client.send.mockRejectedValue(authError("ExpiredTokenException"));
      await expect(provider.set(ctx("db/password"), "v")).rejects.toThrow(AwsAuthError);
    });

    it("wraps auth errors on PutSecretValue fallback", async () => {
      client.send.mockRejectedValueOnce(alreadyExistsError()).mockRejectedValueOnce(authError());
      await expect(provider.set(ctx("db/password"), "v")).rejects.toThrow(AwsAuthError);
    });
  });

  describe("copy", () => {
    function copyCtx(keyPath: string, envName: string | undefined = "prod") {
      return { keyPath, envName, rootDir: "/tmp", config: { region: "eu-west-1" } };
    }

    it("reads source then creates target with the same payload", async () => {
      client.send.mockResolvedValueOnce({ SecretString: "payload" }).mockResolvedValueOnce({});

      await provider.copy(copyCtx("old/key"), copyCtx("new/key"));

      expect(client.send.mock.calls[0][0]).toBeInstanceOf(GetSecretValueCommand);
      expect(client.send.mock.calls[0][0].input.SecretId).toBe("keyshelf/prod/old/key");
      expect(client.send.mock.calls[1][0]).toBeInstanceOf(CreateSecretCommand);
      expect(client.send.mock.calls[1][0].input).toEqual({
        Name: "keyshelf/prod/new/key",
        SecretString: "payload"
      });
    });

    it("does not delete the source", async () => {
      client.send.mockResolvedValueOnce({ SecretString: "v" }).mockResolvedValueOnce({});
      await provider.copy(copyCtx("a"), copyCtx("b"));
      const kinds = client.send.mock.calls.map((c) => commandKind(c[0]));
      expect(kinds).not.toContain("DeleteSecretCommand");
    });

    it("falls back to PutSecretValue when target already exists", async () => {
      client.send
        .mockResolvedValueOnce({ SecretString: "v" })
        .mockRejectedValueOnce(alreadyExistsError())
        .mockResolvedValueOnce({});

      await provider.copy(copyCtx("a"), copyCtx("b"));

      expect(client.send.mock.calls[2][0]).toBeInstanceOf(PutSecretValueCommand);
    });

    it("decodes SecretBinary source payload", async () => {
      client.send
        .mockResolvedValueOnce({
          SecretString: "",
          SecretBinary: new Uint8Array(Buffer.from("bin", "utf-8"))
        })
        .mockResolvedValueOnce({});
      await provider.copy(copyCtx("a"), copyCtx("b"));
      expect(client.send.mock.calls[1][0].input.SecretString).toBe("bin");
    });

    it("throws when source has no payload", async () => {
      client.send.mockResolvedValue({});
      await expect(provider.copy(copyCtx("a"), copyCtx("b"))).rejects.toThrow("has no payload");
    });

    it("wraps auth errors during source read", async () => {
      client.send.mockRejectedValue(authError());
      await expect(provider.copy(copyCtx("a"), copyCtx("b"))).rejects.toThrow(AwsAuthError);
    });
  });

  describe("delete", () => {
    it("force-deletes without recovery window", async () => {
      client.send.mockResolvedValue({});
      await provider.delete(ctx("legacy/key"));
      const call = client.send.mock.calls[0][0];
      expect(call).toBeInstanceOf(DeleteSecretCommand);
      expect(call.input).toEqual({
        SecretId: "keyshelf/prod/legacy/key",
        ForceDeleteWithoutRecovery: true
      });
    });

    it("is idempotent on ResourceNotFoundException", async () => {
      client.send.mockRejectedValue(notFoundError());
      await expect(provider.delete(ctx("legacy/key"))).resolves.toBeUndefined();
    });

    it("rethrows other errors", async () => {
      client.send.mockRejectedValue(new Error("InternalServiceError"));
      await expect(provider.delete(ctx("legacy/key"))).rejects.toThrow("InternalServiceError");
    });

    it("wraps auth errors", async () => {
      client.send.mockRejectedValue(authError());
      await expect(provider.delete(ctx("legacy/key"))).rejects.toThrow(AwsAuthError);
    });
  });

  describe("list", () => {
    function listCtx(overrides: Record<string, unknown> = {}) {
      return {
        rootDir: "/tmp",
        config: { region: "eu-west-1" },
        keyshelfName: "myapp",
        envs: ["dev", "staging", "prod"],
        ...overrides
      };
    }

    function mockListSecrets(pages: Array<{ ids: string[]; next?: string }>) {
      for (const page of pages) {
        client.send.mockResolvedValueOnce({
          SecretList: page.ids.map((id) => ({ Name: id })),
          NextToken: page.next
        });
      }
    }

    it("uses ListSecretsCommand with a name-prefix filter scoped to keyshelfName", async () => {
      mockListSecrets([{ ids: [] }]);
      await provider.list(listCtx());
      const call = client.send.mock.calls[0][0];
      expect(call).toBeInstanceOf(ListSecretsCommand);
      expect(call.input.Filters).toEqual([{ Key: "name", Values: ["keyshelf/myapp/"] }]);
    });

    it("uses keyshelf/ prefix when keyshelfName is absent", async () => {
      mockListSecrets([{ ids: [] }]);
      await provider.list(listCtx({ keyshelfName: undefined }));
      expect(client.send.mock.calls[0][0].input.Filters[0].Values[0]).toBe("keyshelf/");
    });

    it("returns empty array when no secrets match", async () => {
      mockListSecrets([{ ids: ["unrelated", "other/thing"] }]);
      expect(await provider.list(listCtx())).toEqual([]);
    });

    it("filters by prefix and parses env-scoped ids", async () => {
      mockListSecrets([
        {
          ids: [
            "keyshelf/myapp/staging/db/password",
            "keyshelf/myapp/prod/api/token",
            "keyshelf/otherapp/staging/db/password"
          ]
        }
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
      mockListSecrets([{ ids: ["keyshelf/myapp/github/token"] }]);
      const result = await provider.list(listCtx());
      expect(result).toEqual([{ keyPath: "github/token", envName: undefined }]);
    });

    it("paginates via NextToken", async () => {
      mockListSecrets([
        { ids: ["keyshelf/myapp/dev/a"], next: "tok-1" },
        { ids: ["keyshelf/myapp/dev/b"] }
      ]);
      const result = await provider.list(listCtx());
      expect(result).toHaveLength(2);
      expect(client.send.mock.calls).toHaveLength(2);
      expect(client.send.mock.calls[1][0].input.NextToken).toBe("tok-1");
    });

    it("wraps auth errors as AwsAuthError", async () => {
      client.send.mockRejectedValue(authError());
      await expect(provider.list(listCtx())).rejects.toThrow(AwsAuthError);
    });
  });

  describe("auth error detection", () => {
    it("recognises HTTP 403 as auth failure", async () => {
      client.send.mockRejectedValue(http403Error());
      await expect(provider.resolve(ctx("k"))).rejects.toThrow(AwsAuthError);
    });

    it("does not wrap non-auth errors", async () => {
      const err = Object.assign(new Error("InvalidParameter"), { name: "InvalidParameter" });
      client.send.mockRejectedValue(err);
      await expect(provider.resolve(ctx("k"))).rejects.toThrow("InvalidParameter");
      await expect(provider.resolve(ctx("k"))).rejects.not.toThrow(AwsAuthError);
    });
  });

  describe("region resolution", () => {
    it("throws AwsRegionError when SDK reports Region is missing", async () => {
      client.send.mockRejectedValue(regionMissingError());
      await expect(provider.resolve(ctx("k"))).rejects.toThrow(AwsRegionError);
      await expect(provider.resolve(ctx("k"))).rejects.toThrow("AWS_REGION");
    });

    it("works without an explicit region in config (lets SDK resolve)", async () => {
      client.send.mockResolvedValue({ SecretString: "v" });
      await provider.resolve({
        keyPath: "k",
        envName: "prod",
        rootDir: "/tmp",
        config: {}
      });
      expect(client.send).toHaveBeenCalled();
    });
  });
});
