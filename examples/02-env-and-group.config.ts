import { defineConfig, config, secret, age, gcp } from "keyshelf/config";

export default defineConfig({
  envs: ["dev", "staging", "production"],
  groups: ["app"],

  keys: {
    log: {
      level: config({
        group: "app",
        default: "info",
        values: {
          production: "warn"
        }
      })
    },
    db: {
      host: config({
        group: "app",
        default: "localhost",
        values: {
          staging: "staging-db.internal",
          production: "prod-db.internal"
        }
      }),
      password: secret({
        group: "app",
        default: age({ identityFile: "./keys/dev.txt" }),
        values: {
          production: gcp({ project: "myproj" })
        }
      })
    }
  }
});
