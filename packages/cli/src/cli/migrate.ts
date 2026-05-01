import { Command } from "commander";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { loadConfig } from "../config/loader.js";
import { GcpAuthError, toSecretId } from "../providers/gcp-sm.js";

interface MigrateGcpOpts {
  env: string;
  dryRun?: boolean;
  deleteLegacy?: boolean;
}

const AUTH_ERROR_PATTERNS = [
  "invalid_grant",
  "invalid_rapt",
  "reauth related error",
  "token has been expired or revoked",
  "Could not load the default credentials",
  "Could not automatically determine credentials"
];

function isAuthError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: number }).code;
  if (code === 16) return true;
  return AUTH_ERROR_PATTERNS.some((pattern) => err.message.includes(pattern));
}

function isNotFound(err: unknown): boolean {
  return err instanceof Error && (err as { code?: number }).code === 5;
}

interface MigrateRow {
  keyPath: string;
  legacyId: string;
  newId: string;
  status: "migrated" | "already-migrated" | "no-legacy" | "value-mismatch" | "deleted-legacy";
  message?: string;
}

export const migrateCommand = new Command("migrate").description(
  "Migrate secrets to namespaced ids after setting `name` in keyshelf.yaml"
);

migrateCommand
  .command("gcp")
  .description("Copy GCP secrets from legacy ids to ids namespaced by keyshelf `name`")
  .requiredOption("--env <env>", "Environment name")
  .option("--dry-run", "Print actions without making changes")
  .option("--delete-legacy", "Delete legacy secrets after copying (use with care)")
  .action(async (opts: MigrateGcpOpts) => {
    const appDir = process.cwd();
    const config = await loadConfig(appDir, opts.env);

    if (!config.name) {
      console.error(
        'error: keyshelf.yaml is missing top-level "name:". Add it before migrating, e.g.\n\n  name: my-project\n'
      );
      process.exit(1);
    }

    const provider = config.env.defaultProvider;
    if (!provider || provider.name !== "gcp") {
      console.error(
        `error: env "${opts.env}" does not use the gcp default provider (got ${provider?.name ?? "none"})`
      );
      process.exit(1);
    }

    const project = provider.options.project;
    if (typeof project !== "string") {
      console.error(`error: gcp provider for env "${opts.env}" is missing "project" option`);
      process.exit(1);
    }

    const secrets = config.schema.filter((k) => k.isSecret);
    if (secrets.length === 0) {
      console.log("no secrets defined in schema");
      return;
    }

    const client = new SecretManagerServiceClient();
    const rows: MigrateRow[] = [];
    let hadError = false;

    for (const key of secrets) {
      const legacyId = toSecretId(undefined, opts.env, key.path);
      const newId = toSecretId(config.name, opts.env, key.path);

      const legacyName = `projects/${project}/secrets/${legacyId}/versions/latest`;
      const newSecretPath = `projects/${project}/secrets/${newId}`;

      let legacyValue: string | undefined;
      try {
        const [version] = await client.accessSecretVersion({ name: legacyName });
        const payload = version.payload?.data;
        if (!payload) {
          rows.push({
            keyPath: key.path,
            legacyId,
            newId,
            status: "no-legacy",
            message: "legacy secret has no payload"
          });
          continue;
        }
        legacyValue =
          typeof payload === "string" ? payload : Buffer.from(payload).toString("utf-8");
      } catch (err) {
        if (isAuthError(err)) throw new GcpAuthError(err as Error);
        if (isNotFound(err)) {
          rows.push({ keyPath: key.path, legacyId, newId, status: "no-legacy" });
          continue;
        }
        throw err;
      }

      let newValue: string | undefined;
      try {
        const [version] = await client.accessSecretVersion({
          name: `${newSecretPath}/versions/latest`
        });
        const payload = version.payload?.data;
        newValue =
          typeof payload === "string" ? payload : Buffer.from(payload ?? "").toString("utf-8");
      } catch (err) {
        if (isAuthError(err)) throw new GcpAuthError(err as Error);
        if (!isNotFound(err)) throw err;
      }

      if (newValue !== undefined) {
        if (newValue === legacyValue) {
          rows.push({ keyPath: key.path, legacyId, newId, status: "already-migrated" });
          if (opts.deleteLegacy && !opts.dryRun) {
            await client.deleteSecret({ name: `projects/${project}/secrets/${legacyId}` });
            rows[rows.length - 1].status = "deleted-legacy";
          }
          continue;
        }
        rows.push({
          keyPath: key.path,
          legacyId,
          newId,
          status: "value-mismatch",
          message: "new secret already exists with different value — refusing to overwrite"
        });
        hadError = true;
        continue;
      }

      if (opts.dryRun) {
        rows.push({
          keyPath: key.path,
          legacyId,
          newId,
          status: "migrated",
          message: "(dry-run)"
        });
        continue;
      }

      try {
        await client.createSecret({
          parent: `projects/${project}`,
          secretId: newId,
          secret: { replication: { automatic: {} } }
        });
      } catch (err) {
        if (isAuthError(err)) throw new GcpAuthError(err as Error);
        const code = (err as { code?: number }).code;
        if (code !== 6) throw err;
      }

      await client.addSecretVersion({
        parent: newSecretPath,
        payload: { data: Buffer.from(legacyValue, "utf-8") }
      });

      if (opts.deleteLegacy) {
        await client.deleteSecret({ name: `projects/${project}/secrets/${legacyId}` });
        rows.push({ keyPath: key.path, legacyId, newId, status: "deleted-legacy" });
      } else {
        rows.push({ keyPath: key.path, legacyId, newId, status: "migrated" });
      }
    }

    printRows(rows);

    if (hadError) {
      process.exit(1);
    }
  });

function printRows(rows: MigrateRow[]): void {
  const pathWidth = Math.max(...rows.map((r) => r.keyPath.length), 4);
  const statusWidth = Math.max(...rows.map((r) => r.status.length), 6);

  for (const r of rows) {
    const line = [
      r.keyPath.padEnd(pathWidth),
      r.status.padEnd(statusWidth),
      `${r.legacyId} -> ${r.newId}`,
      r.message ?? ""
    ]
      .filter(Boolean)
      .join("   ");
    console.log(line);
  }
}
