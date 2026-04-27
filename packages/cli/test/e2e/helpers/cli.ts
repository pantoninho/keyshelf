import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

function findTsxBin(start: string): string {
  let dir = start;
  while (true) {
    const candidate = join(dir, "node_modules", ".bin", "tsx");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not locate tsx binary starting from ${start}`);
    }
    dir = parent;
  }
}

const PACKAGE_ROOT = join(import.meta.dirname, "..", "..", "..");

export const TSX = findTsxBin(PACKAGE_ROOT);
export const CLI = join(PACKAGE_ROOT, "bin", "keyshelf.ts");
