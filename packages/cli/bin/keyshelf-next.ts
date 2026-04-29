#!/usr/bin/env node

import { createV5Program } from "../src/v5/cli/index.js";

const program = createV5Program();
program.parseAsync(process.argv).catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
