import { defineConfig, config, secret, age } from "keyshelf/config";

export default defineConfig({
  envs: ["dev", "production"],

  keys: {
    services: {
      auth: {
        api: {
          url: "http://localhost:4000",
          key: secret({
            value: age({ identityFile: "./keys/dev.txt" })
          })
        }
      },
      billing: {
        api: {
          url: "http://localhost:4001"
        }
      }
    },

    db: {
      primary: {
        host: "localhost",
        port: 5432
      },
      replica: {
        host: "localhost",
        port: 5433
      }
    },

    "feature-flags/launch-darkly/sdk-key": secret({
      value: age({ identityFile: "./keys/dev.txt" })
    }),
    "feature-flags": {
      "launch-darkly": {
        environment: config({ value: "dev" })
      }
    }
  }
});
