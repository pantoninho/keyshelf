import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadV4Project } from "../src/load-v4.js";
import { normalizeProject, type NormalizedMigration } from "../src/normalize.js";

const here = dirname(fileURLToPath(import.meta.url));

export function fixturePath(name: string): string {
  return join(here, "fixtures", name);
}

export async function loadFixture(
  name: string,
  options: { acceptRenamedName?: boolean } = {}
): Promise<NormalizedMigration> {
  return normalizeProject(await loadV4Project(fixturePath(name)), options);
}
