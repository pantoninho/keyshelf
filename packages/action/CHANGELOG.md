# Changelog

## [1.1.0](https://github.com/pantoninho/keyshelf/compare/keyshelf-action-v1.0.0...keyshelf-action-v1.1.0) (2026-05-07)


### Features

* **cli:** keyshelf up --plan (phase 3 of keyshelf up) ([#124](https://github.com/pantoninho/keyshelf/issues/124)) ([9957128](https://github.com/pantoninho/keyshelf/commit/995712803a0a707656082384164c6578d8326155))
* **cli:** keyshelf up apply (phase 4 of keyshelf up) ([#128](https://github.com/pantoninho/keyshelf/issues/128)) ([9a165b2](https://github.com/pantoninho/keyshelf/commit/9a165b2574d9634bb3b6984ded5449505cafb815))
* **config:** forbid underscore in path segments (phase 5 of keyshelf up) ([#130](https://github.com/pantoninho/keyshelf/issues/130)) ([f89ca7d](https://github.com/pantoninho/keyshelf/commit/f89ca7d943a9afe4f1c4077c60591cc9d91ec016))
* **config:** support keyshelf.yaml as a runtime config format ([#123](https://github.com/pantoninho/keyshelf/issues/123)) ([9ee0a8d](https://github.com/pantoninho/keyshelf/commit/9ee0a8d2292fa75a4d2ee76e78b65b5425a91fb5))
* detect v4 config and migrate gcp ids before emitting v5 config ([#115](https://github.com/pantoninho/keyshelf/issues/115)) ([d84ab4d](https://github.com/pantoninho/keyshelf/commit/d84ab4dec61edb0fc876e0ed3782a95554abb0cd))
* **providers:** add aws secrets manager provider ([#132](https://github.com/pantoninho/keyshelf/issues/132)) ([4f966f9](https://github.com/pantoninho/keyshelf/commit/4f966f9e80ebe6483f3cd886b6bd503faa700778))
* **providers:** add list capability (phase 1 of keyshelf up) ([#121](https://github.com/pantoninho/keyshelf/issues/121)) ([8dce488](https://github.com/pantoninho/keyshelf/commit/8dce4880740ff91c565c0ecdc09dfa2d4bc4640c))
* **reconcile:** plan engine (phase 2 of keyshelf up) ([#122](https://github.com/pantoninho/keyshelf/issues/122)) ([d6a29ba](https://github.com/pantoninho/keyshelf/commit/d6a29ba5c6438a3fe01dd97b36eb685724a4627c))


### Bug Fixes

* **action:** write identity for sops-only configs ([#125](https://github.com/pantoninho/keyshelf/issues/125)) ([#127](https://github.com/pantoninho/keyshelf/issues/127)) ([21c36d0](https://github.com/pantoninho/keyshelf/commit/21c36d06701ca4a7668a1fe8c8be502e76cbb321))

## [1.0.0](https://github.com/pantoninho/keyshelf/compare/keyshelf-action-v0.4.0...keyshelf-action-v1.0.0) (2026-05-03)


### ⚠ BREAKING CHANGES

* keyshelf no longer reads keyshelf.yaml or .keyshelf/<env>.yaml. Projects must migrate to keyshelf.config.ts (see @keyshelf/migrate). The keyshelf-next bin, the keyshelf/v5 and keyshelf/bin-next package exports, and the v4 GCP secret-id migrator (keyshelf migrate-gcp) are gone.

### Features

* v5 cutover (phase 8 in [#78](https://github.com/pantoninho/keyshelf/issues/78)) ([#100](https://github.com/pantoninho/keyshelf/issues/100)) ([98b1893](https://github.com/pantoninho/keyshelf/commit/98b1893b4671f74ed21aed5a63091ba640994d35))
* **v5:** action smoke workflow and benchmark ([#99](https://github.com/pantoninho/keyshelf/issues/99)) ([b5e29a5](https://github.com/pantoninho/keyshelf/commit/b5e29a583b8f893aa99cdb0c099fdae27b4767ac))
* **v5:** port the keyshelf action to v5 TS configs ([#96](https://github.com/pantoninho/keyshelf/issues/96)) ([c1d52cf](https://github.com/pantoninho/keyshelf/commit/c1d52cfb72976229e5930c0b1be51c89f1eb5cd1))

## [0.4.0](https://github.com/pantoninho/keyshelf/compare/keyshelf-action-v0.3.0...keyshelf-action-v0.4.0) (2026-05-01)


### Features

* **v4:** add `name` to keyshelf.yaml and namespace gcp secret ids ([#92](https://github.com/pantoninho/keyshelf/issues/92)) ([8ded4f3](https://github.com/pantoninho/keyshelf/commit/8ded4f39ea3e360a754dbd6c40c868cf1f69ae80))

## [0.3.0](https://github.com/pantoninho/keyshelf/compare/keyshelf-action-v0.2.1...keyshelf-action-v0.3.0) (2026-04-27)


### Features

* **action:** bundle keyshelf ([#74](https://github.com/pantoninho/keyshelf/issues/74)) ([c2960b7](https://github.com/pantoninho/keyshelf/commit/c2960b7b94270d9b27914e4bd7bc3bf6afc8f04a))

## [0.2.1](https://github.com/pantoninho/keyshelf/compare/keyshelf-action-v0.2.0...keyshelf-action-v0.2.1) (2026-04-27)


### Bug Fixes

* **action:** always install action deps (closes [#70](https://github.com/pantoninho/keyshelf/issues/70)) ([#71](https://github.com/pantoninho/keyshelf/issues/71)) ([83a3453](https://github.com/pantoninho/keyshelf/commit/83a345381acfc44679a52f98c686ae0266cb52b3))

## [0.2.0](https://github.com/pantoninho/keyshelf/compare/keyshelf-action-v0.1.0...keyshelf-action-v0.2.0) (2026-04-27)


### Features

* monorepo + keyshelf-action (closes [#64](https://github.com/pantoninho/keyshelf/issues/64)) ([#65](https://github.com/pantoninho/keyshelf/issues/65)) ([c49b6ae](https://github.com/pantoninho/keyshelf/commit/c49b6aea06f5a0f019d1cbfa913f8f78c22f5c39))
