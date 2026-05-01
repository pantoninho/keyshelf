import { defineConfig, secret, age, gcp } from "keyshelf/config";

export default defineConfig({
  name: "example-04-optional-secrets",
  envs: ["dev", "production"],
  groups: ["app"],

  keys: {
    sentry: {
      dsn: secret({
        group: "app",
        optional: true,
        values: {
          production: gcp({ project: "myproj" })
        }
      })
    },

    pulumi: {
      "config-passphrase": secret({
        group: "app",
        optional: true,
        default: age({ identityFile: "./keys/dev.txt", secretsDir: "./secrets" }),
        values: {
          production: gcp({ project: "myproj" })
        }
      })
    }
  }
});
