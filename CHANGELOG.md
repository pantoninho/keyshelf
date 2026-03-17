# Changelog

## [2.1.0](https://github.com/pantoninho/keyshelf/compare/v2.0.2...v2.1.0) (2026-03-17)


### Features

* auto-create SecretRef in YAML when `set` targets a new path ([#25](https://github.com/pantoninho/keyshelf/issues/25)) ([edb2771](https://github.com/pantoninho/keyshelf/commit/edb2771263cc24d5851de9ea1b368e8275b0b4f7))
* walk-up directory discovery for monorepo support ([#28](https://github.com/pantoninho/keyshelf/issues/28)) ([d207738](https://github.com/pantoninho/keyshelf/commit/d2077382607d0c898297311851168d7ea9ed5042))


### Bug Fixes

* validate environment/project names and harden input handling ([#27](https://github.com/pantoninho/keyshelf/issues/27)) ([08c12c4](https://github.com/pantoninho/keyshelf/commit/08c12c4591683b06cd4175b60f99b4fe705f8d1f))

## [2.0.2](https://github.com/pantoninho/keyshelf/compare/v2.0.1...v2.0.2) (2026-03-17)


### Bug Fixes

* add repository field to package.json for npm provenance ([f84aec9](https://github.com/pantoninho/keyshelf/commit/f84aec931f905fef7699bfbd686e12876e2093e0))

## [2.0.1](https://github.com/pantoninho/keyshelf/compare/v2.0.0...v2.0.1) (2026-03-17)


### Bug Fixes

* exclude CHANGELOG.md from prettier checks ([af66cc3](https://github.com/pantoninho/keyshelf/commit/af66cc3f04e5c4afb4c98c8adb0ccd7cdb409f62))

## [2.0.0](https://github.com/pantoninho/keyshelf/compare/v1.6.0...v2.0.0) (2026-03-17)


### ⚠ BREAKING CHANGES

* remove --from-env flag from up command ([#22](https://github.com/pantoninho/keyshelf/issues/22))
* The `env:` field in environment YAML files is no longer recognized. Create a `.env.keyshelf` file in the project root with `VAR_NAME=path/to/value` mappings instead.
* flatten secret: and config: commands into get/list/set ([#16](https://github.com/pantoninho/keyshelf/issues/16))
* rename env:load to import, env:print to print ([#15](https://github.com/pantoninho/keyshelf/issues/15))

### Features

* flatten secret: and config: commands into get/list/set ([#16](https://github.com/pantoninho/keyshelf/issues/16)) ([172a23c](https://github.com/pantoninho/keyshelf/commit/172a23c747955613761f25f11bcddaae925df8b7))
* move env var mapping from environment YAML to consumer-side .env.keyshelf ([#20](https://github.com/pantoninho/keyshelf/issues/20)) ([be13240](https://github.com/pantoninho/keyshelf/commit/be1324034b56adbf5c38640c69ac08bb1108d42e))
* remove --from-env flag from up command ([#22](https://github.com/pantoninho/keyshelf/issues/22)) ([03c1586](https://github.com/pantoninho/keyshelf/commit/03c1586c8b793a1160659b3f3b6f2f9c7c80c72e))
* rename env:load to import, env:print to print ([#15](https://github.com/pantoninho/keyshelf/issues/15)) ([211faad](https://github.com/pantoninho/keyshelf/commit/211faad9a863a251e4250e25eb6e2fca7adad517))
* set only updates provider values, does not mutate YAML ([#19](https://github.com/pantoninho/keyshelf/issues/19)) ([0f9b32b](https://github.com/pantoninho/keyshelf/commit/0f9b32bd4252c63b29930ba4e9211c7349267dfd))

## Changelog

See [GitHub Releases](https://github.com/pantoninho/keyshelf/releases).
