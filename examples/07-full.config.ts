import { defineConfig, config, secret, age, gcp, sops } from "keyshelf/config";

export default defineConfig({
  name: "example-07-full",
  envs: ["dev", "staging", "production"],
  groups: ["app", "ci", "ops"],

  keys: {
    log: {
      level: config({
        group: "app",
        default: "info",
        values: { production: "warn" }
      }),
      format: "json"
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
      port: 5432,
      user: config({ group: "app", value: "app" }),
      password: secret({
        group: "app",
        default: age({ identityFile: "./keys/dev.txt", secretsDir: "./secrets" }),
        values: {
          staging: sops({ identityFile: "./keys/sops.txt", secretsFile: "./secrets/staging.json" }),
          production: gcp({ project: "myproj" })
        }
      }),
      url: config({
        group: "app",
        default: "postgres://${db/user}:${db/password}@${db/host}:${db/port}/mydb"
      })
    },

    sentry: {
      dsn: secret({
        group: "app",
        optional: true,
        values: {
          production: gcp({ project: "myproj" })
        }
      })
    },

    github: {
      token: secret({
        group: "ci",
        description: "Shared CI token, not env-scoped",
        value: age({ identityFile: "./keys/ci.txt", secretsDir: "./secrets" })
      })
    },

    grafana: {
      api: {
        url: config({
          group: "ops",
          default: "https://grafana.internal"
        }),
        token: secret({
          group: "ops",
          value: gcp({ project: "myproj" })
        })
      }
    }
  }
});
