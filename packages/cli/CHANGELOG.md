# Changelog

## [7.0.0](https://github.com/pantoninho/keyshelf/compare/keyshelf-v6.0.0...keyshelf-v7.0.0) (2026-06-19)


### ⚠ BREAKING CHANGES

* keyshelf no longer reads keyshelf.yaml or .keyshelf/<env>.yaml. Projects must migrate to keyshelf.config.ts (see @keyshelf/migrate). The keyshelf-next bin, the keyshelf/v5 and keyshelf/bin-next package exports, and the v4 GCP secret-id migrator (keyshelf migrate-gcp) are gone.

### Features

* **action:** bundle keyshelf ([#74](https://github.com/pantoninho/keyshelf/issues/74)) ([c2960b7](https://github.com/pantoninho/keyshelf/commit/c2960b7b94270d9b27914e4bd7bc3bf6afc8f04a))
* **cli:** add `keyshelf cp` to copy secrets to the clipboard ([#135](https://github.com/pantoninho/keyshelf/issues/135)) ([425ff63](https://github.com/pantoninho/keyshelf/commit/425ff631046acba11d08fe2469c2a180c83772a5))
* **cli:** hint at keyshelf up after set/import drift (phase 6 of keyshelf up) ([#131](https://github.com/pantoninho/keyshelf/issues/131)) ([4cb2bda](https://github.com/pantoninho/keyshelf/commit/4cb2bda6d77ba35eb003aa0836ab0e965b2ccbea))
* **cli:** keyshelf up --plan (phase 3 of keyshelf up) ([#124](https://github.com/pantoninho/keyshelf/issues/124)) ([9957128](https://github.com/pantoninho/keyshelf/commit/995712803a0a707656082384164c6578d8326155))
* **cli:** keyshelf up apply (phase 4 of keyshelf up) ([#128](https://github.com/pantoninho/keyshelf/issues/128)) ([9a165b2](https://github.com/pantoninho/keyshelf/commit/9a165b2574d9634bb3b6984ded5449505cafb815))
* **config:** add plain() / !plain inline provider for secrets ([#137](https://github.com/pantoninho/keyshelf/issues/137)) ([b8928d2](https://github.com/pantoninho/keyshelf/commit/b8928d2eb890527f33cdfb2d237d20a13b83c69e))
* **config:** forbid underscore in path segments (phase 5 of keyshelf up) ([#130](https://github.com/pantoninho/keyshelf/issues/130)) ([f89ca7d](https://github.com/pantoninho/keyshelf/commit/f89ca7d943a9afe4f1c4077c60591cc9d91ec016))
* **config:** support keyshelf.yaml as a runtime config format ([#123](https://github.com/pantoninho/keyshelf/issues/123)) ([9ee0a8d](https://github.com/pantoninho/keyshelf/commit/9ee0a8d2292fa75a4d2ee76e78b65b5425a91fb5))
* detect v4 config and migrate gcp ids before emitting v5 config ([#115](https://github.com/pantoninho/keyshelf/issues/115)) ([d84ab4d](https://github.com/pantoninho/keyshelf/commit/d84ab4dec61edb0fc876e0ed3782a95554abb0cd))
* env applicability derived from values (N/A exclusion) ([#161](https://github.com/pantoninho/keyshelf/issues/161)) ([4695c7f](https://github.com/pantoninho/keyshelf/commit/4695c7f0a094a041fb609cc31f47572d32616332))
* implement v5 phase 2 config loader ([#82](https://github.com/pantoninho/keyshelf/issues/82)) ([d96194f](https://github.com/pantoninho/keyshelf/commit/d96194f2836ca8b4072ca9150fd81b2a4bffed78))
* **init:** keyshelf init scaffolds config + AGENTS.md entry point ([#171](https://github.com/pantoninho/keyshelf/issues/171)) ([304931a](https://github.com/pantoninho/keyshelf/commit/304931aaad56ae70cf853e26983caa166391dc3c))
* **ls:** opt-in exhaustive validation sweep for CI ([#151](https://github.com/pantoninho/keyshelf/issues/151)) ([ea60893](https://github.com/pantoninho/keyshelf/commit/ea60893339ac3f6fdc61fe2ebe1a96f59ad81668))
* monorepo + keyshelf-action (closes [#64](https://github.com/pantoninho/keyshelf/issues/64)) ([#65](https://github.com/pantoninho/keyshelf/issues/65)) ([c49b6ae](https://github.com/pantoninho/keyshelf/commit/c49b6aea06f5a0f019d1cbfa913f8f78c22f5c39))
* **providers:** add aws secrets manager provider ([#132](https://github.com/pantoninho/keyshelf/issues/132)) ([4f966f9](https://github.com/pantoninho/keyshelf/commit/4f966f9e80ebe6483f3cd886b6bd503faa700778))
* **providers:** add list capability (phase 1 of keyshelf up) ([#121](https://github.com/pantoninho/keyshelf/issues/121)) ([8dce488](https://github.com/pantoninho/keyshelf/commit/8dce4880740ff91c565c0ecdc09dfa2d4bc4640c))
* **reconcile:** plan engine (phase 2 of keyshelf up) ([#122](https://github.com/pantoninho/keyshelf/issues/122)) ([d6a29ba](https://github.com/pantoninho/keyshelf/commit/d6a29ba5c6438a3fe01dd97b36eb685724a4627c))
* **resolver:** scope run resolution + validation to the app mapping ([#150](https://github.com/pantoninho/keyshelf/issues/150)) ([e81a028](https://github.com/pantoninho/keyshelf/commit/e81a028b90deb234b0d6e96cc8cd18bcc8486b91))
* **run:** error on --map reference to an N/A key (ADR-0002) ([#164](https://github.com/pantoninho/keyshelf/issues/164)) ([40672b2](https://github.com/pantoninho/keyshelf/commit/40672b20b821391747ce89e182535c5b7ebe5b70))
* teach the fix in errors for the five agent mistakes ([#168](https://github.com/pantoninho/keyshelf/issues/168)) ([#172](https://github.com/pantoninho/keyshelf/issues/172)) ([2e5db79](https://github.com/pantoninho/keyshelf/commit/2e5db792fb1b8be08d905914e706c97c361001e0))
* **v4:** add `name` to keyshelf.yaml and namespace gcp secret ids ([#92](https://github.com/pantoninho/keyshelf/issues/92)) ([8ded4f3](https://github.com/pantoninho/keyshelf/commit/8ded4f39ea3e360a754dbd6c40c868cf1f69ae80))
* v5 cutover (phase 8 in [#78](https://github.com/pantoninho/keyshelf/issues/78)) ([#100](https://github.com/pantoninho/keyshelf/issues/100)) ([98b1893](https://github.com/pantoninho/keyshelf/commit/98b1893b4671f74ed21aed5a63091ba640994d35))
* **v5:** add --group filter to import; polish CLI help text ([#97](https://github.com/pantoninho/keyshelf/issues/97)) ([30b8089](https://github.com/pantoninho/keyshelf/commit/30b80897e81bf66dd7ffb687c1a93f08086ec196))
* **v5:** enrich resolver skip statuses with structured causes ([#93](https://github.com/pantoninho/keyshelf/issues/93)) ([0eaf9f5](https://github.com/pantoninho/keyshelf/commit/0eaf9f5551eb5b593b2a3e36a28aa2b5c3571a5d))
* **v5:** honor KEYSHELF_CONFIG_MODULE_PATH env override in loader alias ([#95](https://github.com/pantoninho/keyshelf/issues/95)) ([b06729f](https://github.com/pantoninho/keyshelf/commit/b06729f13d64f2732557e2229d31f1cd11aa3469))
* **v5:** Implement v5 phase 3 resolver ([#87](https://github.com/pantoninho/keyshelf/issues/87)) ([989c7c6](https://github.com/pantoninho/keyshelf/commit/989c7c6bb0c6acfa7d441546b91fcd2d370b90c6))
* **v5:** phase 5 — wire run/ls/set/import to v5 loader and resolver ([#91](https://github.com/pantoninho/keyshelf/issues/91)) ([835677a](https://github.com/pantoninho/keyshelf/commit/835677a63b13317d03cd8bb3fa2280f12deeb9b4))
* **v5:** port providers to per-key context with name-namespaced gcp ids ([#90](https://github.com/pantoninho/keyshelf/issues/90)) ([addc5ca](https://github.com/pantoninho/keyshelf/commit/addc5ca07442d4e97d1c0eba22ce314cfe247d25))
* **v5:** port the keyshelf action to v5 TS configs ([#96](https://github.com/pantoninho/keyshelf/issues/96)) ([c1d52cf](https://github.com/pantoninho/keyshelf/commit/c1d52cfb72976229e5930c0b1be51c89f1eb5cd1))
* **v5:** scaffold phase 1 entrypoint ([#80](https://github.com/pantoninho/keyshelf/issues/80)) ([f49969d](https://github.com/pantoninho/keyshelf/commit/f49969dbe379f5eccd6c02339918395368adfebc))


### Bug Fixes

* **cli:** derive --version from package.json (closes [#153](https://github.com/pantoninho/keyshelf/issues/153)) ([#154](https://github.com/pantoninho/keyshelf/issues/154)) ([534fb89](https://github.com/pantoninho/keyshelf/commit/534fb89a1889efcebee434c269f659cdec335462))
* **cli:** hide value input in interactive keyshelf set ([#133](https://github.com/pantoninho/keyshelf/issues/133)) ([1caa064](https://github.com/pantoninho/keyshelf/commit/1caa064b4ac58355e4b32c2ff3d8dbb58b239857))
* **run:** single resolution pass — stop resolving every secret twice ([#146](https://github.com/pantoninho/keyshelf/issues/146)) ([56080c7](https://github.com/pantoninho/keyshelf/commit/56080c755e546a68e8e8dac6dcde1919be67e573))
