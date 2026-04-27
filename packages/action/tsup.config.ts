import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["scripts/write-identity.mjs", "scripts/emit-env.mjs"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  outExtension: () => ({ js: ".mjs" }),
  clean: true,
  sourcemap: false,
  noExternal: [/.*/],
  splitting: false,
  treeshake: true,
  minify: true
});
