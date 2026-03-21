import { describe, it, expect, vi, beforeEach } from "vitest";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { gcpSmProvider, buildSecretId, getGcpProject } from "@/providers/gcp-sm";
import type { ProviderContext } from "@/types";

vi.mock("@google-cloud/secret-manager", () => {
  const MockClient = vi.fn(() => ({
    createSecret: vi.fn(),
    addSecretVersion: vi.fn(),
    accessSecretVersion: vi.fn(),
    deleteSecret: vi.fn()
  }));
  return { SecretManagerServiceClient: MockClient };
});

vi.mock("node:child_process", () => ({
  execSync: vi.fn()
}));

import { execSync } from "node:child_process";

beforeEach(() => {
  vi.mocked(SecretManagerServiceClient).mockClear();
  delete process.env.GOOGLE_CLOUD_PROJECT;
  vi.mocked(execSync).mockReset();
});

const context: ProviderContext = {
  projectName: "my-app",
  env: "production",
  keyPath: "database/password"
};

describe("buildSecretId", () => {
  it("derives correct ID from context — slashes become __", () => {
    expect(buildSecretId(context)).toBe("my-app__production__database__password");
  });
});

describe("getGcpProject", () => {
  it("reads from GOOGLE_CLOUD_PROJECT env var", () => {
    process.env.GOOGLE_CLOUD_PROJECT = "my-gcp-project";
    expect(getGcpProject()).toBe("my-gcp-project");
  });

  it("falls back to gcloud CLI when env var is not set", () => {
    vi.mocked(execSync).mockReturnValue("gcloud-project\n" as unknown as Buffer);
    expect(getGcpProject()).toBe("gcloud-project");
    expect(execSync).toHaveBeenCalledWith("gcloud config get-value project", { encoding: "utf-8" });
  });

  it("throws when neither env var nor gcloud CLI is available", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("gcloud not found");
    });
    expect(() => getGcpProject()).toThrow("GCP project not found");
  });

  it("throws when gcloud returns (unset)", () => {
    vi.mocked(execSync).mockReturnValue("(unset)\n" as unknown as Buffer);
    expect(() => getGcpProject()).toThrow("GCP project not found");
  });

  it("throws when gcloud returns empty or whitespace-only output", () => {
    vi.mocked(execSync).mockReturnValue("  \n" as unknown as Buffer);
    expect(() => getGcpProject()).toThrow("GCP project not found");
  });
});

describe("gcpSmProvider.get", () => {
  it("returns the secret string value", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "my-gcp-project";
    const reference = "projects/my-gcp-project/secrets/my-app__production__database__password";

    const mockAccessSecretVersion = vi
      .fn()
      .mockResolvedValueOnce([{ payload: { data: Buffer.from("my-secret-value") } }]);
    vi.mocked(SecretManagerServiceClient).mockImplementationOnce(
      () =>
        ({ accessSecretVersion: mockAccessSecretVersion }) as unknown as SecretManagerServiceClient
    );

    const result = await gcpSmProvider.get(reference, context);
    expect(result).toBe("my-secret-value");
  });

  it("throws when payload is empty", async () => {
    const reference = "projects/my-gcp-project/secrets/my-app__production__database__password";

    vi.mocked(SecretManagerServiceClient).mockImplementationOnce(
      () =>
        ({
          accessSecretVersion: vi.fn().mockResolvedValueOnce([{ payload: { data: null } }])
        }) as unknown as SecretManagerServiceClient
    );

    await expect(gcpSmProvider.get(reference, context)).rejects.toThrow("empty payload");
  });

  it("throws when SDK errors", async () => {
    const reference = "projects/my-gcp-project/secrets/my-app__production__database__password";

    vi.mocked(SecretManagerServiceClient).mockImplementationOnce(
      () =>
        ({
          accessSecretVersion: vi.fn().mockRejectedValueOnce(new Error("PERMISSION_DENIED"))
        }) as unknown as SecretManagerServiceClient
    );

    await expect(gcpSmProvider.get(reference, context)).rejects.toThrow("PERMISSION_DENIED");
  });
});

describe("gcpSmProvider.set", () => {
  beforeEach(() => {
    process.env.GOOGLE_CLOUD_PROJECT = "my-gcp-project";
  });

  it("creates a new secret and returns the full resource path", async () => {
    const mockCreateSecret = vi.fn().mockResolvedValueOnce([{}]);
    const mockAddSecretVersion = vi.fn().mockResolvedValueOnce([{}]);

    vi.mocked(SecretManagerServiceClient).mockImplementationOnce(
      () =>
        ({
          createSecret: mockCreateSecret,
          addSecretVersion: mockAddSecretVersion
        }) as unknown as SecretManagerServiceClient
    );

    const ref = await gcpSmProvider.set!("my-secret-value", context);
    expect(ref).toBe("projects/my-gcp-project/secrets/my-app__production__database__password");
    expect(mockCreateSecret).toHaveBeenCalledTimes(1);
    expect(mockAddSecretVersion).toHaveBeenCalledTimes(1);
  });

  it("adds a version to an existing secret when ALREADY_EXISTS (code 6)", async () => {
    const alreadyExistsError = Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
    const mockCreateSecret = vi.fn().mockRejectedValueOnce(alreadyExistsError);
    const mockAddSecretVersion = vi.fn().mockResolvedValueOnce([{}]);

    vi.mocked(SecretManagerServiceClient).mockImplementationOnce(
      () =>
        ({
          createSecret: mockCreateSecret,
          addSecretVersion: mockAddSecretVersion
        }) as unknown as SecretManagerServiceClient
    );

    const ref = await gcpSmProvider.set!("my-secret-value", context);
    expect(ref).toBe("projects/my-gcp-project/secrets/my-app__production__database__password");
    expect(mockCreateSecret).toHaveBeenCalledTimes(1);
    expect(mockAddSecretVersion).toHaveBeenCalledTimes(1);
  });

  it("rethrows non-ALREADY_EXISTS errors", async () => {
    const permissionError = Object.assign(new Error("PERMISSION_DENIED"), { code: 7 });
    const mockCreateSecret = vi.fn().mockRejectedValueOnce(permissionError);
    const mockAddSecretVersion = vi.fn();

    vi.mocked(SecretManagerServiceClient).mockImplementationOnce(
      () =>
        ({
          createSecret: mockCreateSecret,
          addSecretVersion: mockAddSecretVersion
        }) as unknown as SecretManagerServiceClient
    );

    await expect(gcpSmProvider.set!("my-secret-value", context)).rejects.toThrow(
      "PERMISSION_DENIED"
    );
    expect(mockAddSecretVersion).not.toHaveBeenCalled();
  });

  it("propagates addSecretVersion error after successful createSecret", async () => {
    const mockCreateSecret = vi.fn().mockResolvedValueOnce([{}]);
    const mockAddSecretVersion = vi.fn().mockRejectedValueOnce(new Error("RESOURCE_EXHAUSTED"));

    vi.mocked(SecretManagerServiceClient).mockImplementationOnce(
      () =>
        ({
          createSecret: mockCreateSecret,
          addSecretVersion: mockAddSecretVersion
        }) as unknown as SecretManagerServiceClient
    );

    await expect(gcpSmProvider.set!("my-secret-value", context)).rejects.toThrow(
      "RESOURCE_EXHAUSTED"
    );
    expect(mockCreateSecret).toHaveBeenCalledTimes(1);
    expect(mockAddSecretVersion).toHaveBeenCalledTimes(1);
  });

  it("rejects key paths containing __", async () => {
    const badContext: ProviderContext = { ...context, keyPath: "bad__path" };
    await expect(gcpSmProvider.set!("value", badContext)).rejects.toThrow(
      "Key paths must not contain '__'"
    );
  });
});

describe("gcpSmProvider.remove", () => {
  it("deletes the secret by reference", async () => {
    const reference = "projects/my-gcp-project/secrets/my-app__production__database__password";
    const mockDeleteSecret = vi.fn().mockResolvedValueOnce([{}]);

    vi.mocked(SecretManagerServiceClient).mockImplementationOnce(
      () => ({ deleteSecret: mockDeleteSecret }) as unknown as SecretManagerServiceClient
    );

    await gcpSmProvider.remove!(reference, context);
    expect(mockDeleteSecret).toHaveBeenCalledWith({ name: reference });
  });

  it("throws when SDK errors", async () => {
    const reference = "projects/my-gcp-project/secrets/my-app__production__database__password";

    vi.mocked(SecretManagerServiceClient).mockImplementationOnce(
      () =>
        ({
          deleteSecret: vi.fn().mockRejectedValueOnce(new Error("PERMISSION_DENIED"))
        }) as unknown as SecretManagerServiceClient
    );

    await expect(gcpSmProvider.remove!(reference, context)).rejects.toThrow("PERMISSION_DENIED");
  });
});
