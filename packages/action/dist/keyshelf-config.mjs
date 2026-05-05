// ../cli/dist/src/config/factories.js
function defineConfig(input) {
  return { __kind: "keyshelf:config", ...input };
}
function config(input) {
  return { __kind: "config", ...input };
}
function secret(input) {
  return { __kind: "secret", ...input };
}
function age(options) {
  return { __kind: "provider:age", name: "age", options };
}
function aws(options = {}) {
  return { __kind: "provider:aws", name: "aws", options };
}
function gcp(options) {
  return { __kind: "provider:gcp", name: "gcp", options };
}
function sops(options) {
  return { __kind: "provider:sops", name: "sops", options };
}

export { age, aws, config, defineConfig, gcp, secret, sops };
