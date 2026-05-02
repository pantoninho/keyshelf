import { defineConfig } from "tsup";

// The action ships a single bundle per entrypoint with all deps inlined,
// EXCEPT for jiti and zod. Both ship as CJS (jiti uses dynamic require for
// Node built-ins; zod is consumed via jiti's resolution path) and break under
// ESM bundling. They are installed at action runtime via `npm install` in
// action.yml's setup step.
//
// `keyshelf-config.mjs` is a sidecar bundle of the v5 factories module. The
// loader resolves the user's `keyshelf/config` import to this file via
// KEYSHELF_CONFIG_MODULE_PATH, set in action.yml. Without it, jiti would try
// to read a sibling next to the bundled emit-env entry, which doesn't exist.
export default defineConfig({
  entry: {
    "write-identity": "scripts/write-identity.mjs",
    "emit-env": "scripts/emit-env.mjs",
    "write-identity-v5": "scripts/write-identity-v5.mjs",
    "emit-env-v5": "scripts/emit-env-v5.mjs",
    "keyshelf-config": "../cli/dist/src/v5/config/index.js"
  },
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  outExtension: () => ({ js: ".mjs" }),
  clean: true,
  sourcemap: false,
  external: ["jiti", "zod"],
  noExternal: [/^(?!jiti|zod).*/],
  splitting: false,
  treeshake: true,
  minify: false
});
