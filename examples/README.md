# Keyshelf v5 examples

These are reference configurations for Phase 0 spec lock. Each file exercises a
specific shape from `docs/v5/spec.md`. They will compile once the Phase 2
loader/types land; until then, treat them as the type-shape contract the
implementation must satisfy.

| File                                                                       | Shapes covered                                                  |
| -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [01-basic.config.ts](./01-basic.config.ts)                                 | Bare scalars, groupless config, no envs in use                  |
| [02-env-and-group.config.ts](./02-env-and-group.config.ts)                 | `values` map keyed by env, `group` field, mixed config + secret |
| [03-envless-shared-secret.config.ts](./03-envless-shared-secret.config.ts) | Envless secret in a group; envless config without a group       |
| [04-optional-secrets.config.ts](./04-optional-secrets.config.ts)           | `optional: true` with and without a binding fallback            |
| [05-nested-namespaces.config.ts](./05-nested-namespaces.config.ts)         | Deep nesting and `'a/b/c'` flattened-path notation              |
| [06-template-config.config.ts](./06-template-config.config.ts)             | `${path/to/key}` interpolation in config values                 |
| [07-full.config.ts](./07-full.config.ts)                                   | Canonical example mixing every shape                            |
