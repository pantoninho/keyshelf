import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SecretsManagerClient,
  DeleteSecretCommand,
  ResourceExistsException
} from "@aws-sdk/client-secrets-manager";
import { awsSmProvider, buildSecretName } from "@/providers/aws-sm";
import type { ProviderContext } from "@/types";

vi.mock("@aws-sdk/client-secrets-manager", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-secrets-manager")>();
  return {
    ...actual,
    SecretsManagerClient: vi.fn()
  };
});

const mockSend = vi.fn();

beforeEach(() => {
  vi.mocked(SecretsManagerClient).mockImplementation(
    () => ({ send: mockSend }) as unknown as SecretsManagerClient
  );
  mockSend.mockReset();
});

const context: ProviderContext = {
  projectName: "my-project",
  env: "production",
  keyPath: "database/password"
};

describe("buildSecretName", () => {
  it("derives correct name from context", () => {
    expect(buildSecretName(context)).toBe("my-project/production/database/password");
  });
});

describe("awsSmProvider.get", () => {
  it("returns the secret string value", async () => {
    mockSend.mockResolvedValueOnce({ SecretString: "my-secret-value" });
    const result = await awsSmProvider.get("my-project/production/database/password", context);
    expect(result).toBe("my-secret-value");
  });

  it("throws when secret is binary (no SecretString)", async () => {
    mockSend.mockResolvedValueOnce({ SecretBinary: new Uint8Array([1, 2, 3]) });
    await expect(
      awsSmProvider.get("my-project/production/database/password", context)
    ).rejects.toThrow("binary secret");
  });

  it("throws when SDK errors", async () => {
    mockSend.mockRejectedValueOnce(new Error("AccessDeniedException"));
    await expect(
      awsSmProvider.get("my-project/production/database/password", context)
    ).rejects.toThrow("AccessDeniedException");
  });
});

describe("awsSmProvider.set", () => {
  it("creates a new secret and returns the derived name", async () => {
    mockSend.mockResolvedValueOnce({});
    const ref = await awsSmProvider.set!("my-secret-value", context);
    expect(ref).toBe("my-project/production/database/password");
  });

  it("updates an existing secret when ResourceExistsException is thrown", async () => {
    mockSend
      .mockRejectedValueOnce(
        new ResourceExistsException({ message: "already exists", $metadata: {} })
      )
      .mockResolvedValueOnce({});

    const ref = await awsSmProvider.set!("my-secret-value", context);
    expect(ref).toBe("my-project/production/database/password");
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("rethrows non-ResourceExistsException errors from CreateSecret", async () => {
    mockSend.mockRejectedValueOnce(new Error("AccessDeniedException"));
    await expect(awsSmProvider.set!("my-secret-value", context)).rejects.toThrow(
      "AccessDeniedException"
    );
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("propagates PutSecretValue errors after ResourceExistsException", async () => {
    mockSend
      .mockRejectedValueOnce(
        new ResourceExistsException({ message: "already exists", $metadata: {} })
      )
      .mockRejectedValueOnce(new Error("InternalServiceError"));

    await expect(awsSmProvider.set!("my-secret-value", context)).rejects.toThrow(
      "InternalServiceError"
    );
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});

describe("awsSmProvider.remove", () => {
  it("deletes the secret with ForceDeleteWithoutRecovery", async () => {
    mockSend.mockResolvedValueOnce({});
    await awsSmProvider.remove!("my-project/production/database/password", context);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const command = mockSend.mock.calls[0][0];
    expect(command).toBeInstanceOf(DeleteSecretCommand);
    expect(command.input).toEqual({
      SecretId: "my-project/production/database/password",
      ForceDeleteWithoutRecovery: true
    });
  });

  it("throws when SDK errors", async () => {
    mockSend.mockRejectedValueOnce(new Error("AccessDeniedException"));
    await expect(
      awsSmProvider.remove!("my-project/production/database/password", context)
    ).rejects.toThrow("AccessDeniedException");
  });
});
