import { join } from "node:path";
import { TSX } from "./cli.js";

const PACKAGE_ROOT = join(import.meta.dirname, "..", "..", "..");

export const V5_CLI = join(PACKAGE_ROOT, "bin", "keyshelf-next.ts");
export { TSX };
