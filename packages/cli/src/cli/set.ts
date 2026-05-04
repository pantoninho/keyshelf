import { Command } from "commander";
import { createInterface } from "node:readline";
import { loadConfig } from "../config/index.js";
import { createDefaultRegistry } from "../providers/setup.js";
import { pickProviderRef, writeSecret } from "./secret-binding.js";

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
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr
  });

  return new Promise((resolve) => {
    process.stderr.write(prompt);
    rl.on("line", (line) => {
      rl.close();
      resolve(line);
    });
  });
}
