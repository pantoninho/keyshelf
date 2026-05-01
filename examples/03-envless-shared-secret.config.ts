import { defineConfig, config, secret, age } from "keyshelf/config";

export default defineConfig({
  name: "example-03-envless-shared-secret",
  envs: ["dev", "production"],
  groups: ["app", "ci"],

  keys: {
    github: {
      token: secret({
        group: "ci",
        value: age({ identityFile: "./keys/ci.txt", secretsDir: "./secrets" })
      })
    },

    npm: {
      registry: config({
        value: "https://registry.npmjs.org/"
      })
    },

    app: {
      name: config({
        group: "app",
        value: "keyshelf"
      })
    }
  }
});
