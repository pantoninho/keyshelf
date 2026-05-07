import { Command } from "commander";
import { loadConfig } from "../config/index.js";
import { createDefaultRegistry } from "../providers/setup.js";
import { findStaleRenameSource, pickProviderRef, writeSecret } from "./secret-binding.js";

interface SetOptions {
  env?: string;
  value?: string;
}

export const setCommand = new Command("set")
  .description(
    "Write a secret value to its bound provider (does not edit keyshelf.config.ts; config keys are hand-edited)"
  )
  .option("--env <env>", "Environment to write into (selects per-env provider binding)")
  .option(
    "--value <value>",
    "Value to set (non-interactive); otherwise prompts on TTY or reads stdin"
  )
  .argument("<key>", "Key path (e.g. db/password)")
  .action(async (keyPath: string, opts: SetOptions) => {
    const appDir = process.cwd();
    const loaded = await loadConfig(appDir);
    const record = loaded.config.keys.find((entry) => entry.path === keyPath);

    if (record === undefined) {
      console.error(`error: key "${keyPath}" is not defined in keyshelf.config.ts`);
      process.exit(1);
    }

    if (record.kind === "config") {
      console.error(
        `error: "${keyPath}" is a config key. keyshelf does not write config values via set — edit keyshelf.config.ts directly.`
      );
      process.exit(1);
    }

    const providerRef = pickProviderRef(record, opts.env);
    if (providerRef === undefined) {
      const envHint = opts.env ?? "(envless)";
      console.error(
        `error: no provider binding for "${keyPath}" in env ${envHint}. Add a value/default or values[${envHint}] entry in keyshelf.config.ts.`
      );
      process.exit(1);
    }

    const value = await readValue(keyPath, opts.value);
    const registry = createDefaultRegistry();

    await writeSecret(registry, loaded, providerRef, keyPath, opts.env, value);

    const where = opts.env ? ` for ${opts.env}` : "";
    console.log(`Stored "${keyPath}" via ${providerRef.name} provider${where}`);

    const stale = await findStaleRenameSource(registry, loaded, record, providerRef, opts.env);
    if (stale !== undefined) {
      console.log(
        `hint: storage still holds old path "${stale}". Run \`keyshelf up\` to clean it up.`
      );
    }
  });

async function readValue(keyPath: string, explicit: string | undefined): Promise<string> {
  if (explicit !== undefined) return explicit;
  if (!process.stdin.isTTY) return readStdinPipe();
  return readHiddenInput(`Enter value for ${keyPath}: `);
}

function readStdinPipe(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data.trim()));
    process.stdin.on("error", reject);
  });
}

function readHiddenInput(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    process.stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf-8");

    let buffer = "";
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);
        if (ch === "\r" || ch === "\n") {
          stdin.removeListener("data", onData);
          stdin.setRawMode(wasRaw);
          stdin.pause();
          process.stderr.write("\n");
          resolve(buffer);
          return;
        }
        if (code === 0x03) {
          stdin.removeListener("data", onData);
          stdin.setRawMode(wasRaw);
          stdin.pause();
          process.stderr.write("\n");
          reject(new Error("aborted"));
          return;
        }
        if (code === 0x7f || code === 0x08) {
          buffer = buffer.slice(0, -1);
          continue;
        }
        buffer += ch;
      }
    };
    stdin.on("data", onData);
  });
}
