import path from "node:path";

/** The project-relative root directory holding all Keyshelf state. */
export const ROOT_DIR = ".keyshelf";
/** The project config file, at the root of {@link ROOT_DIR}. */
export const CONFIG_FILE = "config.yaml";
/** A shelf's schema file, at the root of its shelf directory. */
export const SCHEMA_FILE = "schema.yaml";

/**
 * Every filesystem path that depends on the shelf/stage layout is built here, so
 * the layout lives in exactly one place. The flat layout
 * (`.keyshelf/{shelf}/{stage}.yaml`, schema and environments sharing the shelf
 * directory) is encoded by {@link shelfEnvDir} returning the shelf directory
 * itself; ADR-0011 redirects environments into an `environments/` subfolder by
 * changing only that one helper.
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
 * The directory a shelf's environment files live in. Flat layout: the shelf
 * directory itself (so it also holds `schema.yaml` and, by default, secret
 * stores). This is the single seam ADR-0011 moves to an `environments/` subfolder.
 */
export function shelfEnvDir(root: string, shelf: string): string {
  return shelfDir(root, shelf);
}

/** An environment file: `.keyshelf/{shelf}/{stage}.yaml` in the flat layout. */
export function envFilePath(root: string, shelf: string, stage: string): string {
  return path.join(shelfEnvDir(root, shelf), `${stage}.yaml`);
}
