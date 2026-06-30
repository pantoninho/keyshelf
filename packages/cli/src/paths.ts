import path from "node:path";

/** The project-relative root directory holding all Keyshelf state. */
export const ROOT_DIR = ".keyshelf";
/** The project config file, at the root of {@link ROOT_DIR}. */
export const CONFIG_FILE = "config.yaml";
/** A shelf's schema file, at the root of its shelf directory. */
export const SCHEMA_FILE = "schema.yaml";
/** The reserved subfolder a shelf's environment files live in (ADR-0011). */
export const ENV_DIR = "environments";

/**
 * Every filesystem path that depends on the shelf/stage layout is built here, so
 * the layout lives in exactly one place. Environment files live in a reserved
 * `environments/` subfolder of the shelf directory (ADR-0011): {@link shelfEnvDir}
 * is the single seam expressing that, while {@link schemaFilePath} keeps the
 * schema at the shelf root as a sibling of `environments/`.
 */

/** A shelf's directory: `.keyshelf/{shelf}`. */
export function shelfDir(root: string, shelf: string): string {
  return path.join(root, shelf);
}

/** A shelf's schema file: `.keyshelf/{shelf}/schema.yaml`. */
export function schemaFilePath(root: string, shelf: string): string {
  return path.join(shelfDir(root, shelf), SCHEMA_FILE);
}

/**
 * The directory a shelf's environment files live in: the reserved
 * `environments/` subfolder of the shelf directory (ADR-0011). This is the one
 * folder core scans for environments; the schema lives outside it, at the shelf
 * root.
 */
export function shelfEnvDir(root: string, shelf: string): string {
  return path.join(shelfDir(root, shelf), ENV_DIR);
}

/** An environment file: `.keyshelf/{shelf}/environments/{stage}.yaml`. */
export function envFilePath(root: string, shelf: string, stage: string): string {
  return path.join(shelfEnvDir(root, shelf), `${stage}.yaml`);
}
