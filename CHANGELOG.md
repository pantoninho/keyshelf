# Changelog

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
