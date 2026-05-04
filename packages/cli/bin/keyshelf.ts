#!/usr/bin/env node

import { createProgram } from "../src/cli/index.js";
import { V4ConfigDetectedError } from "../src/config/index.js";
import { handleV4ConfigDetected } from "../src/cli/v4-prompt.js";

const program = createProgram();
program.parseAsync(process.argv).catch(async (err) => {
  if (err instanceof V4ConfigDetectedError) {
    await handleV4ConfigDetected(err);
    console.error("\nkeyshelf: migration complete. Re-run your command.");
    process.exit(0);
  }
  console.error(`error: ${err.message}`);
  process.exit(1);
});
