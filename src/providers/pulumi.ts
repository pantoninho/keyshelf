import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { Provider } from "@/types";

/** Parse a "stack.outputName" reference into its components */
export function parseReference(reference: string): { stack: string; outputName: string } {
  const dotIndex = reference.indexOf(".");
  if (dotIndex <= 0 || dotIndex === reference.length - 1) {
    throw new Error(
      `Invalid !pulumi reference '${reference}'. Expected format: 'stack.outputName'.`
    );
  }
  return {
    stack: reference.slice(0, dotIndex),
    outputName: reference.slice(dotIndex + 1)
  };
}

function runPulumiCli(stack: string, outputName: string, cwd: string): string {
  const result = spawnSync(
    "pulumi",
    ["stack", "output", outputName, "--json", "--show-secrets", "-s", stack, "-C", cwd],
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  );

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `pulumi exited with code ${result.status}`);
  }

  return result.stdout.trim();
}

function getOutput(stack: string, outputName: string, cwd: string): string {
  const raw = runPulumiCli(stack, outputName, resolve(cwd));
  const parsed = JSON.parse(raw);

  if (typeof parsed !== "string") {
    throw new Error(
      `Pulumi output '${outputName}' from stack '${stack}' is not a string (got ${typeof parsed}). Only string outputs are supported.`
    );
  }

  return parsed;
}

/** Create a read-only Pulumi provider bound to a project directory */
export function createPulumiProvider(cwd: string): Provider {
  return {
    async get(reference) {
      const { stack, outputName } = parseReference(reference);
      return getOutput(stack, outputName, cwd);
    }
  };
}
