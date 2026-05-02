#!/usr/bin/env node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const packages = ["jiti@^2.6.1", "zod@^4.4.1"];
const installArgs = ["install", "--no-save", "--no-audit", "--no-fund", "--no-package-lock"];

const root = await mkdtemp(join(tmpdir(), "keyshelf-action-runtime-deps-"));
const cacheDir = join(root, "npm-cache");

try {
  const cold = await runInstall("cold");
  const warm = await runInstall("warm");
  const result = {
    packages,
    coldMs: cold.durationMs,
    warmMs: warm.durationMs
  };

  process.stdout.write(`v5 runtime dependency install benchmark\n`);
  process.stdout.write(`cold: ${formatMs(result.coldMs)}\n`);
  process.stdout.write(`warm: ${formatMs(result.warmMs)}\n`);

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    await writeFile(
      summary,
      [
        "## keyshelf action v5 runtime dependency benchmark",
        "",
        "| run | duration |",
        "| --- | ---: |",
        `| cold | ${formatMs(result.coldMs)} |`,
        `| warm | ${formatMs(result.warmMs)} |`,
        ""
      ].join("\n"),
      { flag: "a" }
    );
  }
} finally {
  if (process.env.KEYSHELF_KEEP_BENCHMARK_DIR !== "1") {
    await rm(root, { recursive: true, force: true });
  } else {
    process.stdout.write(`kept benchmark directory: ${root}\n`);
  }
}

async function runInstall(label) {
  const cwd = await mkdtemp(join(root, `${label}-`));
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2) + "\n"
  );

  const start = performance.now();
  const res = spawnSync("npm", [...installArgs, "--cache", cacheDir, ...packages], {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const durationMs = performance.now() - start;

  if (res.status !== 0) {
    process.stderr.write(res.stdout);
    process.stderr.write(res.stderr);
    throw new Error(`npm ${installArgs.join(" ")} failed with status ${res.status}`);
  }

  return { durationMs };
}

function formatMs(ms) {
  return `${Math.round(ms)}ms`;
}
