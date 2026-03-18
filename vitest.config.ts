import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "src"),
        },
    },
    test: {
        exclude: [".claude/**", "node_modules/**"],
        testTimeout: 15000,
    },
});
