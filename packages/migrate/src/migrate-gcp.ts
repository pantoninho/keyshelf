import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import type { NormalizedMigration, NormalizedRecord, ProviderRef } from "./normalize.js";
import { toSecretId } from "./secret-id.js";

export { toSecretId };

export interface GcpMigrateOptions {
  dryRun?: boolean;
  deleteLegacy?: boolean;
  client?: SecretManagerServiceClient;
}

export type GcpRowStatus =
  | "migrated"
  | "already-migrated"
  | "no-legacy"
  | "value-mismatch"
  | "deleted-legacy";

export interface GcpMigrationRow {
  env: string;
  keyPath: string;
  project: string;
  legacyId: string;
  newId: string;
  status: GcpRowStatus;
  message?: string;
}

export interface GcpMigrationResult {
  rows: GcpMigrationRow[];
  hadError: boolean;
}

const AUTH_ERROR_PATTERNS = [
  "invalid_grant",
  "invalid_rapt",
  "reauth related error",
  "token has been expired or revoked",
  "Could not load the default credentials",
  "Could not automatically determine credentials"
];

export class GcpAuthError extends Error {
  constructor(cause?: Error) {
    super(
      "GCP authentication failed. Run `gcloud auth application-default login` to re-authenticate."
    );
    this.name = "GcpAuthError";
    this.cause = cause;
  }
}

function isAuthError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: number }).code;
  if (code === 16) return true;
  return AUTH_ERROR_PATTERNS.some((pattern) => err.message.includes(pattern));
}

function isNotFound(err: unknown): boolean {
  return err instanceof Error && (err as { code?: number }).code === 5;
}

interface PlannedMigration {
  env: string;
  record: NormalizedRecord;
  binding: ProviderRef;
}

function planMigrations(migration: NormalizedMigration): PlannedMigration[] {
  const planned: PlannedMigration[] = [];
  for (const record of migration.keys) {
    if (record.kind !== "secret") continue;
    for (const env of migration.envs) {
      const binding =
        record.values !== undefined && Object.hasOwn(record.values, env)
          ? record.values[env]
          : record.default;
      if (binding === undefined || binding.name !== "gcp") continue;
      planned.push({ env, record, binding });
    }
  }
  return planned;
}

export function hasGcpBindings(migration: NormalizedMigration): boolean {
  return planMigrations(migration).length > 0;
}

export async function migrateGcpSecrets(
  migration: NormalizedMigration,
  options: GcpMigrateOptions = {}
): Promise<GcpMigrationResult> {
  const planned = planMigrations(migration);
  if (planned.length === 0) {
    return { rows: [], hadError: false };
  }

  const client = options.client ?? new SecretManagerServiceClient();
  const rows: GcpMigrationRow[] = [];
  let hadError = false;

  for (const { env, record, binding } of planned) {
    const project = binding.options.project;
    if (typeof project !== "string") {
      throw new Error(`gcp binding for ${env}:${record.path} is missing a "project" option`);
    }
    const legacyId = toSecretId(undefined, env, record.path);
    const newId = toSecretId(migration.name, env, record.path);

    let stepResult: Pick<GcpMigrationRow, "status" | "message">;
    try {
      stepResult = await migrateOne(client, project, legacyId, newId, options);
    } catch (err) {
      if (isAuthError(err)) throw new GcpAuthError(err as Error);
      throw err;
    }

    rows.push({
      env,
      keyPath: record.path,
      project,
      legacyId,
      newId,
      ...stepResult
    });
    if (stepResult.status === "value-mismatch") hadError = true;
  }

  return { rows, hadError };
}

async function migrateOne(
  client: SecretManagerServiceClient,
  project: string,
  legacyId: string,
  newId: string,
  options: GcpMigrateOptions
): Promise<Pick<GcpMigrationRow, "status" | "message">> {
  const legacyValue = await readSecret(client, project, legacyId);
  if (legacyValue === undefined) {
    return { status: "no-legacy" };
  }

  const newValue = await readSecret(client, project, newId);
  if (newValue !== undefined) {
    if (newValue === legacyValue) {
      if (options.deleteLegacy && !options.dryRun) {
        await client.deleteSecret({ name: `projects/${project}/secrets/${legacyId}` });
        return { status: "deleted-legacy" };
      }
      return { status: "already-migrated" };
    }
    return {
      status: "value-mismatch",
      message: "new secret already exists with a different value — refusing to overwrite"
    };
  }

  if (options.dryRun) {
    return { status: "migrated", message: "(dry-run)" };
  }

  await ensureSecret(client, project, newId);
  await client.addSecretVersion({
    parent: `projects/${project}/secrets/${newId}`,
    payload: { data: Buffer.from(legacyValue, "utf-8") }
  });

  if (options.deleteLegacy) {
    await client.deleteSecret({ name: `projects/${project}/secrets/${legacyId}` });
    return { status: "deleted-legacy" };
  }
  return { status: "migrated" };
}

async function readSecret(
  client: SecretManagerServiceClient,
  project: string,
  secretId: string
): Promise<string | undefined> {
  try {
    const [version] = await client.accessSecretVersion({
      name: `projects/${project}/secrets/${secretId}/versions/latest`
    });
    const payload = version.payload?.data;
    if (!payload) return undefined;
    return typeof payload === "string" ? payload : Buffer.from(payload).toString("utf-8");
  } catch (err) {
    if (isNotFound(err)) return undefined;
    throw err;
  }
}

async function ensureSecret(
  client: SecretManagerServiceClient,
  project: string,
  secretId: string
): Promise<void> {
  try {
    await client.createSecret({
      parent: `projects/${project}`,
      secretId,
      secret: { replication: { automatic: {} } }
    });
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code !== 6) throw err;
  }
}

export function formatGcpRows(rows: GcpMigrationRow[]): string {
  if (rows.length === 0) return "";
  const pathWidth = Math.max(...rows.map((r) => `${r.env}:${r.keyPath}`.length), 4);
  const statusWidth = Math.max(...rows.map((r) => r.status.length), 6);

  return rows
    .map((r) => {
      const label = `${r.env}:${r.keyPath}`.padEnd(pathWidth);
      return [label, r.status.padEnd(statusWidth), `${r.legacyId} -> ${r.newId}`, r.message ?? ""]
        .filter(Boolean)
        .join("   ");
    })
    .join("\n");
}
