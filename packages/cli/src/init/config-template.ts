/**
 * The starter `keyshelf.config.ts` scaffolded by `keyshelf init` into a repo
 * that does not yet have one. Minimal, valid, and commented: a `name`, an
 * `envs` list, and one config key plus one secret key as worked examples. The
 * secret uses `plain()` so the scaffold validates and resolves with no external
 * provider setup — the author swaps it for a real provider (age/aws/...) when
 * they wire up secret storage.
 */
export function buildConfigTemplate(): string {
  return `import { defineConfig, config, secret, plain } from "keyshelf/config";

// keyshelf declares your config and secret keys once and resolves them per
// environment. After editing this file, run \`keyshelf check\`. Full agent
// rules: \`keyshelf rules\`. Spec: docs/spec.md.
export default defineConfig({
  // Project name — used to namespace stored secrets.
  name: "my-app",

  // The environments your keys resolve for.
  envs: ["dev", "prod"],

  keys: {
    // A config key: a plain (non-secret) value, here with an envless fallback.
    "api-url": config({ default: "https://api.example.com" }),

    // A secret key: its value comes from a provider binding. \`plain()\` keeps
    // the value inline so the scaffold works out of the box — swap it for a
    // real provider (e.g. age/aws/gcp/sops) and run \`keyshelf set\`.
    "api-token": secret({ value: plain("replace-me") }),
  },
});
`;
}
