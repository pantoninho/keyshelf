import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/**/*.ts", "bin/keyshelf.ts"],
  format: ["esm"],
  target: "node20",
  bundle: false,
  clean: true,
  sourcemap: true,
  dts: { entry: "src/index.ts" }
});
