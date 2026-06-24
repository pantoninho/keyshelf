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

  /** The version selector of a `.../versions/X` resource: a number or "latest". */
  function versionOf(resource: string): string {
    const match = resource.match(/\/versions\/([^/]+)$/);
    return match ? match[1] : "latest";
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
      // The real API returns the created version resource, whose trailing segment
      // is the concrete version number write records (ADR-0009).
      return [{ name: `${request.parent}/versions/${secret.versions.length}` }];
    },
    async accessSecretVersion(request) {
      const id = idOf(request.name, "version");
      const secret = secrets.get(id);
      if (!secret || secret.versions.length === 0) {
        throw Object.assign(new Error("not found"), { code: 5 });
      }

      // Version numbers are 1-based and ascending; "latest" is the newest.
      const selector = versionOf(request.name);
      const index =
        selector === "latest" ? secret.versions.length - 1 : Number.parseInt(selector, 10) - 1;
      const data = secret.versions[index];
      if (data === undefined) {
        throw Object.assign(new Error("no such version"), { code: 5 });
      }

      // The real API echoes the concrete resolved version in `name`, which is how
      // the adapter learns the latest version number for --pin-latest.
      const resolvedVersion = selector === "latest" ? String(secret.versions.length) : selector;
      const base = request.name.replace(/\/versions\/[^/]+$/, "");
      return [{ name: `${base}/versions/${resolvedVersion}`, payload: { data } }];
    }
  };

  // Plant a secret directly in the backend (bypassing the adapter) so a test can
  // model a foreign or hand-created secret whose bytes Keyshelf never wrote.
  function seed(id: string, bytes: Buffer): void {
    secrets.set(id, { replication: { automatic: {} }, versions: [bytes] });
  }

  return { client, createCalls, seed };
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
    namespace: opts?.namespace ?? "keyshelf__myapp__web__staging",
    location: opts?.location,
    client
  });
}

describe("GcpAdapter", () => {
  describe("naming convention", () => {
    it("stores under {namespace}__{key} and returns that id from write", async () => {
      const { client } = fakeClient();
      const { ref } = await adapter(client).write("DATABASE_PASSWORD", "sekret");
      expect(ref).toBe("keyshelf__myapp__web__staging__DATABASE_PASSWORD");
    });

    it("resolves a value written by convention", async () => {
      const { client } = fakeClient();
      const a = adapter(client);
      await a.write("TOKEN", "value-1");
      expect(await a.resolve("TOKEN")).toBe("value-1");
    });

    it("keeps the same key in different namespaces distinct", async () => {
      const { client } = fakeClient();
      const staging = adapter(client, { namespace: "keyshelf__myapp__web__staging" });
      const prod = adapter(client, { namespace: "keyshelf__myapp__web__prod" });
      await staging.write("TOKEN", "staging-token");
      await prod.write("TOKEN", "prod-token");
      expect(await staging.resolve("TOKEN")).toBe("staging-token");
      expect(await prod.resolve("TOKEN")).toBe("prod-token");
    });

    it("resolves a foreign value through an explicit ref", async () => {
      const { client } = fakeClient();
      const a = adapter(client);
      const { ref } = await a.write("CANONICAL_KEY", "foreign-value");
      expect(await a.resolve("A_DIFFERENT_KEY", ref)).toBe("foreign-value");
    });

    it("resolves a foreign/hand-created secret holding raw (non-JSON) bytes", async () => {
      // A secret Keyshelf never wrote holds its literal value, not a JSON
      // envelope. Raw storage must read it back verbatim — the JSON-envelope
      // scheme used to reject this as ADAPTER_ERROR (ADR-0006).
      const { client, seed } = fakeClient();
      seed("foreign-token", Buffer.from("raw-token-no-quotes", "utf8"));
      const a = adapter(client);
      expect(await a.resolve("ANY_KEY", { ref: "foreign-token" })).toBe("raw-token-no-quotes");
    });

    it("overwrites with the latest version on a repeated write", async () => {
      const { client } = fakeClient();
      const a = adapter(client);
      await a.write("KEY", "first");
      await a.write("KEY", "second");
      expect(await a.resolve("KEY")).toBe("second");
    });
  });

  describe("version pinning (ADR-0009)", () => {
    it("resolves exactly the pinned version, not latest", async () => {
      const { client } = fakeClient();
      const a = adapter(client);
      await a.write("TOKEN", "v1");
      await a.write("TOKEN", "v2");
      await a.write("TOKEN", "v3");
      // Pin to version 1 (the convention name): must return v1, not latest (v3).
      expect(await a.resolve("TOKEN", { version: 1 })).toBe("v1");
      expect(await a.resolve("TOKEN", { version: 2 })).toBe("v2");
      // No pin ⇒ latest.
      expect(await a.resolve("TOKEN")).toBe("v3");
    });

    it("resolves a foreign secret pinned to a version via { ref, version }", async () => {
      const { client, seed } = fakeClient();
      seed("shared-token", Buffer.from("foreign-v1", "utf8"));
      const a = adapter(client);
      expect(await a.resolve("ANY_KEY", { ref: "shared-token", version: 1 })).toBe("foreign-v1");
    });

    it("write returns the concrete version it created", async () => {
      const { client } = fakeClient();
      const a = adapter(client);
      expect((await a.write("TOKEN", "first")).version).toBe("1");
      expect((await a.write("TOKEN", "second")).version).toBe("2");
    });

    it("write returns the convention ref alongside the version", async () => {
      const { client } = fakeClient();
      const result = await adapter(client).write("DATABASE_PASSWORD", "sekret");
      expect(result.ref).toBe("keyshelf__myapp__web__staging__DATABASE_PASSWORD");
      expect(result.version).toBe("1");
    });

    it("addresses the pinned version in metadata (not latest)", () => {
      const { client } = fakeClient();
      const meta = adapter(client).metadata("DATABASE_PASSWORD", { version: 5 });
      expect(meta.resource).toBe(
        "projects/test-proj/secrets/keyshelf__myapp__web__staging__DATABASE_PASSWORD/versions/5"
      );
    });

    it("addresses a foreign pinned ref's version in metadata", () => {
      const { client } = fakeClient();
      const meta = adapter(client).metadata("ANY_KEY", { ref: "shared-token", version: 4 });
      expect(meta.resource).toBe("projects/test-proj/secrets/shared-token/versions/4");
    });

    it("reads the current latest version number (for --pin-latest)", async () => {
      const { client } = fakeClient();
      const a = adapter(client);
      await a.write("TOKEN", "v1");
      await a.write("TOKEN", "v2");
      expect(await a.latestVersion("TOKEN")).toBe("2");
    });

    it("latestVersion of a foreign ref reads through the explicit name", async () => {
      const { client, seed } = fakeClient();
      seed("shared-token", Buffer.from("foreign", "utf8"));
      const a = adapter(client);
      expect(await a.latestVersion("ANY_KEY", { ref: "shared-token" })).toBe("1");
    });
  });

  describe("metadata (offline address)", () => {
    it("returns the full convention version resource for a bare key", () => {
      const { client } = fakeClient();
      const meta = adapter(client).metadata("DATABASE_PASSWORD");
      expect(meta).toEqual({
        adapter: "gcp",
        resource:
          "projects/test-proj/secrets/keyshelf__myapp__web__staging__DATABASE_PASSWORD/versions/latest"
      });
    });

    it("addresses an explicit bare-id ref in the configured project", () => {
      const { client } = fakeClient();
      const meta = adapter(client).metadata("ANY_KEY", { ref: "shared-token" });
      expect(meta).toEqual({
        adapter: "gcp",
        resource: "projects/test-proj/secrets/shared-token/versions/latest"
      });
    });

    it("addresses a foreign full-resource ref verbatim, appending versions/latest", () => {
      const { client } = fakeClient();
      const meta = adapter(client).metadata("ANY_KEY", {
        ref: "projects/other-proj/secrets/foreign"
      });
      expect(meta).toEqual({
        adapter: "gcp",
        resource: "projects/other-proj/secrets/foreign/versions/latest"
      });
    });

    it("preserves a foreign full-resource ref that already pins a version", () => {
      const { client } = fakeClient();
      const meta = adapter(client).metadata("ANY_KEY", {
        ref: "projects/other-proj/secrets/foreign/versions/3"
      });
      expect(meta.resource).toBe("projects/other-proj/secrets/foreign/versions/3");
    });

    it("computes the address with no backend call (offline)", () => {
      // A client that rejects every call: metadata must never touch it.
      const client = throwingClient(new Error("network must not be reached"));
      const meta = adapter(client).metadata("KEY");
      expect(meta.adapter).toBe("gcp");
    });
  });

  describe("value fidelity (byte-exact round-trip)", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["embedded newlines", "line1\nline2\nline3"],
      ["trailing/leading whitespace", "  padded value \t"],
      ["equals signs", "postgres://h?a=b=c&d=e"],
      ["quotes", `it's a "quoted" 'value'`],
      ["unicode", "café — 日本語 — 🔐 — Ω"],
      ["multi-KB blob", "x".repeat(8192)]
    ];

    for (const [label, value] of cases) {
      it(`round-trips ${label}`, async () => {
        const { client } = fakeClient();
        const a = adapter(client);
        await a.write("FIDELITY_KEY", value);
        expect(await a.resolve("FIDELITY_KEY")).toBe(value);
      });
    }

    it("stores the raw value verbatim, with no JSON envelope (native-mountable)", async () => {
      // The payload bytes must BE the value, so Cloud Run / gcloud read it
      // without unwrapping a JSON quote.
      const { client } = fakeClient();
      const captured: Buffer[] = [];
      const spy: SecretsClient = {
        ...client,
        async addSecretVersion(request) {
          captured.push(request.payload.data);
          return client.addSecretVersion(request);
        }
      };
      await adapter(spy).write("TOKEN", "plain-value");
      expect(captured[0].toString("utf8")).toBe("plain-value");
    });

    it("rejects an empty value with ADAPTER_ERROR (Secret Manager forbids empty payloads)", async () => {
      const { client, createCalls } = fakeClient();
      const error = await captureError(() => adapter(client).write("EMPTY", ""));
      expect(error.code).toBe("ADAPTER_ERROR");
      // It refuses up front — no secret container is ever created.
      expect(createCalls).toHaveLength(0);
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
