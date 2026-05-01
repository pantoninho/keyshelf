import { defineConfig } from "keyshelf/config";

export default defineConfig({
  name: "example-01-basic",
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
