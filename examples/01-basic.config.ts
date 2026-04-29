import { defineConfig } from "keyshelf/config";

export default defineConfig({
  envs: ["dev"],

  keys: {
    log: {
      level: "info",
      format: "json"
    },
    server: {
      host: "localhost",
      port: 3000,
      debug: true
    }
  }
});
