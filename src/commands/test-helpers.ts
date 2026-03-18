import { execFileSync, ExecFileSyncOptions } from "node:child_process";
import { join } from "node:path";
import { resolve } from "node:path";

const PROJECT_ROOT = resolve(__dirname, "../..");
const TSX = join(PROJECT_ROOT, "node_modules/.bin/tsx");
const TSCONFIG = join(PROJECT_ROOT, "tsconfig.json");
const ENTRY = join(PROJECT_ROOT, "src/index.ts");

/**
 * Creates a `cli` helper bound to a specific working directory.
 *
 * @param cwd - The working directory for the spawned process.
 * @returns A function that invokes `tsx src/index.ts` with the given args.
 */
export function createCli(cwd: string) {
  return function cli(
    args: string[],
    options: Omit<ExecFileSyncOptions, "encoding"> & {
      input?: string;
    } = {}
  ): string {
    const { input, env, ...rest } = options;
    return execFileSync(TSX, ["--tsconfig", TSCONFIG, ENTRY, ...args], {
      cwd,
      env: { ...process.env, HOME: cwd, ...env },
      encoding: "utf-8",
      input,
      timeout: 15000,
      ...rest
    });
  };
}
