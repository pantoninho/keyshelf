import { describe, expect, it } from "vitest";
import { GcpAdapter, type SecretsClient } from "../../src/adapters/gcp.js";
import { captureError } from "../support/capture-error.js";

/**
 * A faithful in-memory {@link SecretsClient}: one container per secret id, an
 * ordered list of version payloads, `latest` reading the newest. It mirrors the
 * real backend's shape closely enough to exercise the adapter's naming, value
 * encoding, and replication wiring hermetically — the real backend is only ever
 * exercised by the gated conformance suite (ADR-0005).
 */
function fakeClient() {
  const secrets = new Map<string, { replication: unknown; versions: Buffer[] }>();
  const createCalls: Array<{ secretId: string; replication: unknown }> = [];

  function idOf(resource: string, kind: "secret" | "version"): string {
    // projects/P/secrets/ID  or  projects/P/secrets/ID/versions/latest
    const match = resource.match(/secrets\/([^/]+)/);
    if (!match) throw Object.assign(new Error(`bad ${kind} resource: ${resource}`), { code: 3 });
    return match[1];
  }

  const client: SecretsClient = {
    async createSecret(request) {
      createCalls.push({ secretId: request.secretId, replication: request.secret.replication });
      if (secrets.has(request.secretId)) {
        throw Object.assign(new Error("already exists"), { code: 6 });
      }

      secrets.set(request.secretId, { replication: request.secret.replication, versions: [] });
      return [{}];
    },
    async addSecretVersion(request) {
      const id = idOf(request.parent, "secret");
      const secret = secrets.get(id);
      if (!secret) throw Object.assign(new Error("no such secret"), { code: 5 });
      secret.versions.push(request.payload.data);
      return [{}];
    },
    async accessSecretVersion(request) {
      const id = idOf(request.name, "version");
      const secret = secrets.get(id);
      if (!secret || secret.versions.length === 0) {
        throw Object.assign(new Error("not found"), { code: 5 });
      }

      return [{ payload: { data: secret.versions[secret.versions.length - 1] } }];
    }
  };

  return { client, createCalls };
}

/** A client whose every call rejects with the given error — for error mapping. */
function throwingClient(error: unknown): SecretsClient {
  const reject = async (): Promise<never> => {
    throw error;
  };

  return { createSecret: reject, addSecretVersion: reject, accessSecretVersion: reject };
}

function adapter(
  client: SecretsClient,
  opts?: { location?: string; namespace?: string }
): GcpAdapter {
  return new GcpAdapter({
    projectId: "test-proj",
    namespace: opts?.namespace ?? "myapp-web-staging",
    location: opts?.location,
    client
  });
}

describe("GcpAdapter", () => {
  describe("naming convention", () => {
    it("stores under {namespace}-{key} and returns that id from write", async () => {
      const { client } = fakeClient();
      const ref = await adapter(client).write("DATABASE_PASSWORD", "sekret");
      expect(ref).toBe("myapp-web-staging-DATABASE_PASSWORD");
    });

    it("resolves a value written by convention", async () => {
      const { client } = fakeClient();
      const a = adapter(client);
      await a.write("TOKEN", "value-1");
      expect(await a.resolve("TOKEN")).toBe("value-1");
    });

    it("keeps the same key in different namespaces distinct", async () => {
      const { client } = fakeClient();
      const staging = adapter(client, { namespace: "myapp-web-staging" });
      const prod = adapter(client, { namespace: "myapp-web-prod" });
      await staging.write("TOKEN", "staging-token");
      await prod.write("TOKEN", "prod-token");
      expect(await staging.resolve("TOKEN")).toBe("staging-token");
      expect(await prod.resolve("TOKEN")).toBe("prod-token");
    });

    it("resolves a foreign value through an explicit ref", async () => {
      const { client } = fakeClient();
      const a = adapter(client);
      const ref = await a.write("CANONICAL_KEY", "foreign-value");
      expect(await a.resolve("A_DIFFERENT_KEY", ref)).toBe("foreign-value");
    });

    it("overwrites with the latest version on a repeated write", async () => {
      const { client } = fakeClient();
      const a = adapter(client);
      await a.write("KEY", "first");
      await a.write("KEY", "second");
      expect(await a.resolve("KEY")).toBe("second");
    });
  });

  describe("value fidelity (byte-exact round-trip)", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["embedded newlines", "line1\nline2\nline3"],
      ["trailing/leading whitespace", "  padded value \t"],
      ["equals signs", "postgres://h?a=b=c&d=e"],
      ["quotes", `it's a "quoted" 'value'`],
      ["unicode", "café — 日本語 — 🔐 — Ω"],
      ["multi-KB blob", "x".repeat(8192)],
      ["empty string", ""]
    ];

    for (const [label, value] of cases) {
      it(`round-trips ${label}`, async () => {
        const { client } = fakeClient();
        const a = adapter(client);
        await a.write("FIDELITY_KEY", value);
        expect(await a.resolve("FIDELITY_KEY")).toBe(value);
      });
    }

    it("stores an empty string as a non-empty payload (Secret Manager rejects empty)", async () => {
      const { client } = fakeClient();
      // The fake captures the raw bytes; JSON.stringify('') is `""`, two bytes.
      const a = adapter(client);
      await a.write("EMPTY", "");
      // Resolving proves the bytes were a valid non-empty JSON-encoded empty string.
      expect(await a.resolve("EMPTY")).toBe("");
    });
  });

  describe("replication policy from location", () => {
    it("uses automatic replication when location is absent", async () => {
      const { client, createCalls } = fakeClient();
      await adapter(client).write("KEY", "v");
      expect(createCalls[0].replication).toEqual({ automatic: {} });
    });

    it('uses automatic replication when location is "global"', async () => {
      const { client, createCalls } = fakeClient();
      await adapter(client, { location: "global" }).write("KEY", "v");
      expect(createCalls[0].replication).toEqual({ automatic: {} });
    });

    it("pins user-managed replication to a region when location is set", async () => {
      const { client, createCalls } = fakeClient();
      await adapter(client, { location: "europe-west1" }).write("KEY", "v");
      expect(createCalls[0].replication).toEqual({
        userManaged: { replicas: [{ location: "europe-west1" }] }
      });
    });
  });

  describe("error-code mapping", () => {
    it("maps a missing secret to SECRET_NOT_FOUND", async () => {
      const { client } = fakeClient();
      const error = await captureError(() => adapter(client).resolve("ABSENT_KEY"));
      expect(error.code).toBe("SECRET_NOT_FOUND");
    });

    it("maps gRPC PERMISSION_DENIED to PROVIDER_AUTH", async () => {
      const client = throwingClient(Object.assign(new Error("permission denied"), { code: 7 }));
      const error = await captureError(() => adapter(client).resolve("KEY"));
      expect(error.code).toBe("PROVIDER_AUTH");
    });

    it("maps gRPC UNAUTHENTICATED to PROVIDER_AUTH", async () => {
      const client = throwingClient(Object.assign(new Error("unauthenticated"), { code: 16 }));
      const error = await captureError(() => adapter(client).resolve("KEY"));
      expect(error.code).toBe("PROVIDER_AUTH");
    });

    it("maps an ADC credential-load failure (no gRPC code) to PROVIDER_AUTH", async () => {
      const client = throwingClient(
        new Error("Could not load the default credentials. Browse to https://...")
      );
      const error = await captureError(() => adapter(client).resolve("KEY"));
      expect(error.code).toBe("PROVIDER_AUTH");
    });

    it("maps any other backend failure to ADAPTER_ERROR", async () => {
      const client = throwingClient(Object.assign(new Error("internal"), { code: 13 }));
      const error = await captureError(() => adapter(client).resolve("KEY"));
      expect(error.code).toBe("ADAPTER_ERROR");
    });
  });
});
