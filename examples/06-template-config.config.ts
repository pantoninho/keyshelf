import { defineConfig, config, secret, age } from "keyshelf/config";

export default defineConfig({
  envs: ["dev", "production"],

  keys: {
    db: {
      host: config({
        default: "localhost",
        values: {
          production: "prod-db.internal"
        }
      }),
      port: 5432,
      user: "app",
      password: secret({
        value: age({ identityFile: "./keys/dev.txt" })
      }),

      url: config({
        default: "postgres://${db/user}:${db/password}@${db/host}:${db/port}/mydb"
      })
    },

    server: {
      host: "localhost",
      port: 8080,
      "public-url": config({
        default: "http://${server/host}:${server/port}",
        values: {
          production: "https://app.example.com"
        }
      })
    },

    docs: {
      escaped: config({
        value: "literal $${not/a/reference} dollar-brace"
      })
    }
  }
});
