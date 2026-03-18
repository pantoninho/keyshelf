import { defineConfig } from "tsup";
import type { BuildOptions } from "esbuild";

export default defineConfig({
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    target: "node20",
    banner: { js: "#!/usr/bin/env node" },
    esbuildOptions(options: BuildOptions) {
        options.alias = { "@": "./src" };
    },
});
