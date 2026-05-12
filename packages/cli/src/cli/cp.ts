import { createHash } from "node:crypto";
import spawn from "cross-spawn";
import { Command } from "commander";
import { loadConfig } from "../config/index.js";
import { resolveWithStatus } from "../resolver/index.js";
import { createDefaultRegistry } from "../providers/setup.js";
import { assertValidationPasses } from "./validation.js";
import { readClipboard, writeClipboard } from "../utils/clipboard.js";
import type { KeyResolutionStatus } from "../resolver/types.js";

interface CpOptions {
  env?: string;
  quiet?: boolean;
  clear?: string;
}

const DEFAULT_CLEAR_SECONDS = 60;

export const cpCommand = new Command("cp")
  .description("Resolve a key and copy its value to the system clipboard")
  .option("--env <env>", "Environment name (required if the key has per-env bindings)")
  .option("-q, --quiet", "Suppress confirmation output")
  .option(
    "--clear <seconds>",
    `Seconds before the clipboard is cleared; 0 disables (default ${DEFAULT_CLEAR_SECONDS})`
  )
  .argument("<key>", "Key path (e.g. db/password)")
  .action(async (keyPath: string, opts: CpOptions) => {
    const clearSeconds = parseClearSeconds(opts);

    const loaded = await loadConfig(process.cwd());
    const record = loaded.config.keys.find((entry) => entry.path === keyPath);
    if (record === undefined) {
      console.error(`error: key "${keyPath}" is not defined in keyshelf.config.ts`);
      process.exit(1);
    }

    const resolveOpts = {
      config: loaded.config,
      envName: opts.env,
      rootDir: loaded.rootDir,
      registry: createDefaultRegistry(),
      filters: [keyPath]
    };

    await assertValidationPasses(resolveOpts);
    const resolution = await resolveWithStatus(resolveOpts);
    const status = resolution.statusByPath.get(keyPath);

    if (status === undefined || status.status !== "resolved") {
      console.error(`error: cannot copy "${keyPath}" — ${describeUnresolved(status)}`);
      process.exit(1);
    }

    await writeClipboard(status.value);

    if (clearSeconds !== undefined) {
      scheduleClear(status.value, clearSeconds);
    }

    if (!opts.quiet) {
      const envLabel = opts.env ?? "(envless)";
      const tail = clearSeconds !== undefined ? ` (clears in ${clearSeconds}s)` : "";
      console.error(`copied "${keyPath}" from ${envLabel}${tail}`);
    }
  });

export const cpClearCommand = new Command("__cp-clear")
  .description("internal: clears the clipboard if it still holds the given hash")
  .argument("<hash>", "sha256 hex of the value to clear")
  .argument("<seconds>", "delay in seconds before clearing")
  .action(async (hashHex: string, secondsRaw: string) => {
    const seconds = Number(secondsRaw);
    if (!Number.isFinite(seconds) || seconds < 0) return;

    await wait(seconds * 1000);

    try {
      const current = await readClipboard();
      if (sha256(current) === hashHex) {
        await writeClipboard("");
      }
    } catch {
      // clipboard tool gone or unreadable — nothing to do
    }
  });

function parseClearSeconds(opts: CpOptions): number | undefined {
  if (opts.clear === undefined) return DEFAULT_CLEAR_SECONDS;
  const n = Number(opts.clear);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`error: --clear must be a non-negative number of seconds`);
    process.exit(1);
  }
  return n === 0 ? undefined : n;
}

function scheduleClear(value: string, seconds: number): void {
  const hashHex = sha256(value);
  const child = spawn(process.execPath, [process.argv[1], "__cp-clear", hashHex, String(seconds)], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeUnresolved(status: KeyResolutionStatus | undefined): string {
  if (status === undefined) return "no resolution status";
  if (status.status === "error") return status.message;
  if (status.status === "filtered") return "value is filtered out";
  return "value is unavailable";
}
