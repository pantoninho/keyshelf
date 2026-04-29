import { defineConfig, secret, age, gcp } from "keyshelf/config";

export default defineConfig({
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
        default: age({ identityFile: "./keys/dev.txt" }),
        values: {
          production: gcp({ project: "myproj", secret: "pulumi-passphrase" })
        }
      })
    }
  }
});
