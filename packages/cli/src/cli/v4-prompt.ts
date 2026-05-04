import { createInterface } from "node:readline/promises";
import { stdin, stderr, stdout } from "node:process";
import spawn from "cross-spawn";
import type { V4ConfigDetectedError } from "../config/index.js";

export interface V4PromptIO {
  readonly input: NodeJS.ReadableStream & { isTTY?: boolean };
  readonly output: NodeJS.WritableStream;
  readonly errorOutput: NodeJS.WritableStream;
}

const defaultIO: V4PromptIO = {
  input: stdin,
  output: stdout,
  errorOutput: stderr
};

export async function handleV4ConfigDetected(
  err: V4ConfigDetectedError,
  io: V4PromptIO = defaultIO
): Promise<void> {
  io.errorOutput.write(
    `keyshelf: detected v4 keyshelf.yaml at ${err.v4SchemaPath}.\n` +
      `v5 expects keyshelf.config.ts in a parent directory.\n`
  );

  if (io.input.isTTY !== true) {
    io.errorOutput.write(
      `Run \`npx @keyshelf/migrate\` in ${err.v4RootDir} to migrate, then re-run this command.\n`
    );
    process.exit(1);
  }

  if (!(await ask(io, "Run @keyshelf/migrate now? [y/N] "))) {
    process.exit(1);
  }

  const migrateCode = await runSubprocess("npx", ["-y", "@keyshelf/migrate"], err.v4RootDir, io);
  if (migrateCode !== 0) {
    io.errorOutput.write(`@keyshelf/migrate exited with code ${migrateCode}.\n`);
    process.exit(migrateCode);
  }
}

async function ask(io: V4PromptIO, prompt: string): Promise<boolean> {
  const rl = createInterface({ input: io.input, output: io.output });
  try {
    const answer = (await rl.question(prompt)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function runSubprocess(cmd: string, args: string[], cwd: string, io: V4PromptIO): Promise<number> {
  return new Promise((resolveSpawn) => {
    const child = spawn(cmd, args, { stdio: "inherit", cwd });
    child.on("exit", (code) => resolveSpawn(code ?? 1));
    child.on("error", (spawnErr) => {
      io.errorOutput.write(`Failed to run ${cmd}: ${spawnErr.message}\n`);
      resolveSpawn(1);
    });
  });
}
