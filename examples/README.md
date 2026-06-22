# Keyshelf examples

Runnable v6 example projects. Each subdirectory is a complete, self-contained
Keyshelf project: a `.keyshelf/` with a `config.yaml` (project + providers), one
or more shelves (each a directory holding a `schema.yaml`), and per-environment
YAML files (`{stage}.yaml`). They demonstrate the v6 model — filesystem-derived
identity, a closed schema contract, and secrets resolved through a provider.

Every example uses the self-contained `fake` adapter so nothing here needs cloud
credentials. The `fake` adapter keeps secret values in a committed JSON store
(`.keyshelf/.fake-store.json`); a real project would point `adapter:` at `sops`
or `gcp` instead, leaving the schema and environment files unchanged.

| Project                                           | Scenario                                                                                                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`01-basic/`](./01-basic)                         | A single shelf with one environment, plaintext config only. Schema defaults overridden per environment.                                                               |
| [`02-multi-environment/`](./02-multi-environment) | One shelf, three environments (`dev`, `staging`, `production`) implementing the same schema, each overriding what it needs.                                           |
| [`03-presence-rules/`](./03-presence-rules)       | The three schema presence rules side by side: a config default, `!required`, and `!optional`.                                                                         |
| [`04-secret-provider/`](./04-secret-provider)     | A required key satisfied with a `!secret` resolved through a provider, alongside plaintext config and an explicit `!secret { ref: ... }` for a shared/foreign secret. |
| [`05-multi-shelf/`](./05-multi-shelf)             | One project with two shelves (`web-service`, `worker`), each with its own schema, sharing a project-global provider; addressed as `{shelf}/{stage}`.                  |

## File layout

```
NN-example/
└── .keyshelf/
    ├── config.yaml          # project + providers (required)
    ├── {shelf}/             # one shelf per schema
    │   ├── schema.yaml      # the shelf's closed validation contract
    │   └── {stage}.yaml       # an environment implementing the schema
    └── .fake-store.json     # the fake adapter's secret store (stands in for a backend)
```

Identity is filesystem-derived: the shelf is its directory name, the environment
is its filename, the schema is the shelf's `schema.yaml`. There are no `name:` or
`schema:` fields. An environment is addressed as `{shelf}/{stage}` (e.g.
`web/staging`).

## Trying them out

Build the CLI once from the repo root, then run commands with an example
directory as the working directory:

```sh
npm run build -w keyshelf
cd examples/02-multi-environment

# Validate the whole project (structure + every declared secret resolves):
keyshelf validate

# Validate one environment:
keyshelf validate web/staging

# Resolve config + secrets into env vars and run a command:
keyshelf run web/production -- printenv | grep DB_
```

(If you have not linked the `keyshelf` bin, invoke it directly:
`node ../../packages/cli/bin/run.js validate`.)

Every command supports `--json` for machine-readable output and errors.

## Keeping the examples honest

The root `validate:examples` script builds the CLI and validates every project
here against it, so the examples cannot silently rot when the model changes:

```sh
npm run validate:examples
```

It runs in CI's `quality` job. To add a new example, drop a `NN-name/.keyshelf/`
project in this directory; the script discovers it automatically (any subdirectory
with a `.keyshelf/config.yaml`).
