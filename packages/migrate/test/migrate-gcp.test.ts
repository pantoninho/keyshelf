import { describe, expect, it } from "vitest";
import { hasGcpBindings, migrateGcpSecrets, toSecretId } from "../src/migrate-gcp.js";
import type { NormalizedMigration } from "../src/normalize.js";

interface MockSecretStore {
  [secretId: string]: string;
}

function createMockClient(initial: MockSecretStore) {
  const store: MockSecretStore = { ...initial };
  const calls = {
    accessSecretVersion: 0,
    createSecret: 0,
    addSecretVersion: 0,
    deleteSecret: 0
  };

  return {
    store,
    calls,
    accessSecretVersion: async ({ name }: { name: string }) => {
      calls.accessSecretVersion++;
      const match = name.match(/^projects\/([^/]+)\/secrets\/([^/]+)\/versions\/latest$/);
      if (match === null) throw new Error(`bad access name: ${name}`);
      const [, , secretId] = match;
      const value = store[secretId];
      if (value === undefined) {
        const err = new Error(`secret ${secretId} not found`) as Error & { code: number };
        err.code = 5;
        throw err;
      }
      return [{ payload: { data: Buffer.from(value, "utf-8") } }];
    },
    createSecret: async ({ secretId }: { secretId: string }) => {
      calls.createSecret++;
      if (Object.hasOwn(store, secretId)) {
        const err = new Error(`secret ${secretId} already exists`) as Error & { code: number };
        err.code = 6;
        throw err;
      }
      store[secretId] = "";
    },
    addSecretVersion: async ({
      parent,
      payload
    }: {
      parent: string;
      payload: { data: Buffer };
    }) => {
      calls.addSecretVersion++;
      const match = parent.match(/^projects\/[^/]+\/secrets\/([^/]+)$/);
      if (match === null) throw new Error(`bad parent: ${parent}`);
      const [, secretId] = match;
      store[secretId] = payload.data.toString("utf-8");
    },
    deleteSecret: async ({ name }: { name: string }) => {
      calls.deleteSecret++;
      const match = name.match(/^projects\/[^/]+\/secrets\/([^/]+)$/);
      if (match === null) throw new Error(`bad delete name: ${name}`);
      const [, secretId] = match;
      delete store[secretId];
    }
  };
}

const baseMigration: NormalizedMigration = {
  name: "demo",
  envs: ["dev", "production"],
  groups: [],
  keys: [
    {
      path: "db/password",
      kind: "secret",
      optional: false,
      values: {
        production: { name: "gcp", options: { project: "prod-project" } }
      }
    },
    {
      path: "api/token",
      kind: "secret",
      optional: false,
      values: {
        production: { name: "gcp", options: { project: "prod-project" } },
        dev: { name: "age", options: {} }
      }
    },
    {
      path: "log/level",
      kind: "config",
      optional: false,
      default: "info"
    }
  ],
  appMapping: []
};

describe("toSecretId", () => {
  it("namespaces by keyshelf name when provided", () => {
    expect(toSecretId("demo", "production", "db/password")).toBe(
      "keyshelf__demo__production__db__password"
    );
  });

  it("omits the name segment when keyshelfName is undefined (legacy)", () => {
    expect(toSecretId(undefined, "production", "db/password")).toBe(
      "keyshelf__production__db__password"
    );
  });
});

describe("hasGcpBindings", () => {
  it("returns true when at least one secret binds to gcp in any env", () => {
    expect(hasGcpBindings(baseMigration)).toBe(true);
  });

  it("returns false when no gcp bindings exist", () => {
    expect(
      hasGcpBindings({
        ...baseMigration,
        keys: baseMigration.keys.filter((k) => k.path === "log/level")
      })
    ).toBe(false);
  });
});

describe("migrateGcpSecrets", () => {
  it("copies legacy ids to namespaced ids per gcp-bound env", async () => {
    const client = createMockClient({
      keyshelf__production__db__password: "secret-pw",
      keyshelf__production__api__token: "secret-token"
    });
    const result = await migrateGcpSecrets(baseMigration, { client: client as never });

    expect(result.hadError).toBe(false);
    expect(result.rows.map((r) => `${r.env}:${r.keyPath}:${r.status}`)).toEqual([
      "production:db/password:migrated",
      "production:api/token:migrated"
    ]);
    expect(client.store.keyshelf__demo__production__db__password).toBe("secret-pw");
    expect(client.store.keyshelf__demo__production__api__token).toBe("secret-token");
    expect(client.store.keyshelf__production__db__password).toBe("secret-pw");
  });

  it("reports already-migrated when the namespaced id has the same value", async () => {
    const client = createMockClient({
      keyshelf__production__db__password: "secret-pw",
      keyshelf__demo__production__db__password: "secret-pw"
    });
    const result = await migrateGcpSecrets(
      {
        ...baseMigration,
        keys: [baseMigration.keys[0]]
      },
      { client: client as never }
    );

    expect(result.rows[0].status).toBe("already-migrated");
    expect(client.calls.addSecretVersion).toBe(0);
  });

  it("flags value-mismatch and sets hadError when the namespaced id has a different value", async () => {
    const client = createMockClient({
      keyshelf__production__db__password: "old",
      keyshelf__demo__production__db__password: "new-different"
    });
    const result = await migrateGcpSecrets(
      {
        ...baseMigration,
        keys: [baseMigration.keys[0]]
      },
      { client: client as never }
    );

    expect(result.hadError).toBe(true);
    expect(result.rows[0].status).toBe("value-mismatch");
  });

  it("emits no-legacy and writes nothing when the legacy id is missing", async () => {
    const client = createMockClient({});
    const result = await migrateGcpSecrets(
      {
        ...baseMigration,
        keys: [baseMigration.keys[0]]
      },
      { client: client as never }
    );

    expect(result.rows[0].status).toBe("no-legacy");
    expect(client.calls.addSecretVersion).toBe(0);
  });

  it("does not write under --dry-run", async () => {
    const client = createMockClient({
      keyshelf__production__db__password: "secret-pw"
    });
    const result = await migrateGcpSecrets(
      {
        ...baseMigration,
        keys: [baseMigration.keys[0]]
      },
      { client: client as never, dryRun: true }
    );

    expect(result.rows[0].status).toBe("migrated");
    expect(result.rows[0].message).toBe("(dry-run)");
    expect(client.calls.addSecretVersion).toBe(0);
    expect(client.calls.createSecret).toBe(0);
  });

  it("deletes legacy secrets when --delete-legacy is set", async () => {
    const client = createMockClient({
      keyshelf__production__db__password: "secret-pw"
    });
    const result = await migrateGcpSecrets(
      {
        ...baseMigration,
        keys: [baseMigration.keys[0]]
      },
      { client: client as never, deleteLegacy: true }
    );

    expect(result.rows[0].status).toBe("deleted-legacy");
    expect(client.store.keyshelf__production__db__password).toBeUndefined();
    expect(client.store.keyshelf__demo__production__db__password).toBe("secret-pw");
  });
});
