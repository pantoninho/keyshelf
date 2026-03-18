# keyshelf

CLI tool for managing hierarchical config values and secrets across environments.

## Architecture

- **CLI framework**: citty
- **Build**: tsup (bundles to single `dist/index.js`)
- **Commands**: `src/commands/<command>.ts` — citty subcommands
- **Schema**: `src/schema.ts` — YAML parsing/writing with custom tags
- **Resolver**: `src/resolver.ts` — resolves key values through providers
- **Providers**: `src/providers/` — age (local encryption), awssm, gcsm, pulumi
- **Types**: `src/types.ts` — `KeyshelfSchema`, `Provider`, `TaggedValue`, etc.
- **Path aliases**: `@/` maps to `src/` (configured in tsconfig, tsup, and vitest)

## Development workflow

- **Test-first**: Always write tests before implementation. Run tests, confirm failures, then implement.
- Tests are co-located with source files (`src/**/*.test.ts`)

## Commands

```bash
npm run build   # tsup
npm run test    # vitest run
npm run dev     # tsx src/index.ts
```

## Code conventions

- TypeScript strict mode, ESM (`"type": "module"`, bundler module resolution)
- 2-space indentation, double quotes, semicolons
- Tests co-located with source using vitest (`describe`/`it`/`expect`)
- Config values live in version-controlled `keyshelf.yaml`
- Secrets referenced via custom YAML tags: `!age`, `!awssm`, `!gcsm`, `!pulumi`
- Secret values must never appear in error messages, logs, or stack traces
