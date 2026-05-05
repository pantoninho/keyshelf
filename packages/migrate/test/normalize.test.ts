import { describe, expect, it } from "vitest";
import { loadV4Project } from "../src/load-v4.js";
import { normalizeProject } from "../src/normalize.js";
import { fixturePath, loadFixture } from "./test-utils.js";

describe("normalizeProject", () => {
  it("normalizes basic v4 keys and env providers", async () => {
    await expect(loadFixture("basic")).resolves.toMatchObject({
      name: "demo-app",
      envs: ["dev"],
      groups: [],
      keys: [
        { path: "api/url", kind: "config", default: "https://api.example.com" },
        {
          path: "db/host",
          kind: "config",
          default: "localhost",
          values: { dev: "dev-db.local" }
        },
        { path: "db/password", kind: "secret", default: { name: "age" } },
        { path: "db/port", kind: "config", default: "5432" }
      ]
    });
  });

  it("expands env default providers into per-secret values", async () => {
    const migration = await loadFixture("multi-env");
    expect(migration.keys).toContainEqual({
      path: "api/token",
      kind: "secret",
      optional: false,
      values: {
        dev: {
          name: "age",
          options: {
            identityFile: "./keys/default.txt",
            secretsDir: "./.keyshelf/secrets/dev"
          }
        },
        production: {
          name: "gcp",
          options: {
            project: "prod-project"
          }
        }
      }
    });
    expect(migration.keys).toContainEqual({
      path: "worker/token",
      kind: "secret",
      optional: false,
      values: {
        dev: {
          name: "age",
          options: {
            identityFile: "./keys/default.txt",
            secretsDir: "./.keyshelf/secrets/worker-dev"
          }
        },
        production: {
          name: "gcp",
          options: {
            project: "prod-project"
          }
        }
      }
    });
  });

  it("preserves optional secrets when a provider binding exists", async () => {
    const migration = await loadFixture("optional");
    expect(migration.keys).toContainEqual({
      path: "analytics/key",
      kind: "secret",
      optional: true,
      default: {
        name: "sops",
        options: {
          identityFile: "./keys/dev.txt",
          secretsFile: "./.keyshelf/secrets/dev.json"
        }
      }
    });
  });

  it("preserves v4 names with underscores and mixed case as-is", async () => {
    const project = await loadV4Project(fixturePath("name-rename"));
    expect(normalizeProject(project)).toMatchObject({ name: "My_Project" });
  });
});
