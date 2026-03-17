# keyshelf

CLI tool for managing hierarchical config values and secrets across environments.

## Architecture

- **CLI framework**: oclif (`@oclif/core`), topic separator is `:`
- **Commands**: `src/commands/<command>.ts` or `src/commands/<topic>/<verb>.ts` — oclif discovers them from `dist/commands/`
- **Core logic**: `src/core/` — PathTree, YAML parsing, environment resolver
- **Providers**: `src/providers/` — SecretProvider implementations (local filesystem, etc.)
- **Types**: `src/core/types.ts` — `SecretRef`, `EnvironmentDefinition`, `KeyshelfConfig`

## Development workflow

- **Test-first**: Always write tests before implementation. Run tests, confirm failures, then implement.
- **Implementation plan**: See `PLAN.md` for phased implementation with commit messages.

## Commands

```bash
npm run build        # tsc
npm run test         # vitest run
npm run test:watch   # vitest
npm run lint         # eslint src/
npm run format       # prettier --write .
npm run format:check # prettier --check .
```

## Code conventions

- TypeScript strict mode, ESM (`"type": "module"`, `Node16` module resolution)
- 4-space indentation, single quotes, no trailing commas, semicolons (see `.prettierrc`)
- Tests in `test/` mirroring `src/` structure, using vitest (`describe`/`it`/`expect`)
- Config values live in version-controlled YAML; secrets live in external providers
- YAML files reference secrets via `!secret` custom tags (safe to commit)
- Secret values must never appear in error messages, logs, or stack traces
