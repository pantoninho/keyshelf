# Changelog

## [5.0.0](https://github.com/pantoninho/keyshelf/compare/keyshelf-v4.6.0...keyshelf-v5.0.0) (2026-05-03)


### ⚠ BREAKING CHANGES

* keyshelf no longer reads keyshelf.yaml or .keyshelf/<env>.yaml. Projects must migrate to keyshelf.config.ts (see @keyshelf/migrate). The keyshelf-next bin, the keyshelf/v5 and keyshelf/bin-next package exports, and the v4 GCP secret-id migrator (keyshelf migrate-gcp) are gone.

### Features

* v5 cutover (phase 8 in [#78](https://github.com/pantoninho/keyshelf/issues/78)) ([#100](https://github.com/pantoninho/keyshelf/issues/100)) ([98b1893](https://github.com/pantoninho/keyshelf/commit/98b1893b4671f74ed21aed5a63091ba640994d35))
* **v5:** add --group filter to import; polish CLI help text ([#97](https://github.com/pantoninho/keyshelf/issues/97)) ([30b8089](https://github.com/pantoninho/keyshelf/commit/30b80897e81bf66dd7ffb687c1a93f08086ec196))
* **v5:** enrich resolver skip statuses with structured causes ([#93](https://github.com/pantoninho/keyshelf/issues/93)) ([0eaf9f5](https://github.com/pantoninho/keyshelf/commit/0eaf9f5551eb5b593b2a3e36a28aa2b5c3571a5d))
* **v5:** honor KEYSHELF_CONFIG_MODULE_PATH env override in loader alias ([#95](https://github.com/pantoninho/keyshelf/issues/95)) ([b06729f](https://github.com/pantoninho/keyshelf/commit/b06729f13d64f2732557e2229d31f1cd11aa3469))
* **v5:** port the keyshelf action to v5 TS configs ([#96](https://github.com/pantoninho/keyshelf/issues/96)) ([c1d52cf](https://github.com/pantoninho/keyshelf/commit/c1d52cfb72976229e5930c0b1be51c89f1eb5cd1))

## [4.6.0](https://github.com/pantoninho/keyshelf/compare/keyshelf-v4.5.0...keyshelf-v4.6.0) (2026-05-01)


### Features

* implement v5 phase 2 config loader ([#82](https://github.com/pantoninho/keyshelf/issues/82)) ([d96194f](https://github.com/pantoninho/keyshelf/commit/d96194f2836ca8b4072ca9150fd81b2a4bffed78))
* **v4:** add `name` to keyshelf.yaml and namespace gcp secret ids ([#92](https://github.com/pantoninho/keyshelf/issues/92)) ([8ded4f3](https://github.com/pantoninho/keyshelf/commit/8ded4f39ea3e360a754dbd6c40c868cf1f69ae80))
* **v5:** Implement v5 phase 3 resolver ([#87](https://github.com/pantoninho/keyshelf/issues/87)) ([989c7c6](https://github.com/pantoninho/keyshelf/commit/989c7c6bb0c6acfa7d441546b91fcd2d370b90c6))
* **v5:** phase 5 — wire run/ls/set/import to v5 loader and resolver ([#91](https://github.com/pantoninho/keyshelf/issues/91)) ([835677a](https://github.com/pantoninho/keyshelf/commit/835677a63b13317d03cd8bb3fa2280f12deeb9b4))
* **v5:** port providers to per-key context with name-namespaced gcp ids ([#90](https://github.com/pantoninho/keyshelf/issues/90)) ([addc5ca](https://github.com/pantoninho/keyshelf/commit/addc5ca07442d4e97d1c0eba22ce314cfe247d25))
* **v5:** scaffold phase 1 entrypoint ([#80](https://github.com/pantoninho/keyshelf/issues/80)) ([f49969d](https://github.com/pantoninho/keyshelf/commit/f49969dbe379f5eccd6c02339918395368adfebc))

## [4.5.0](https://github.com/pantoninho/keyshelf/compare/keyshelf-v4.4.0...keyshelf-v4.5.0) (2026-04-27)


### Features

* **action:** bundle keyshelf ([#74](https://github.com/pantoninho/keyshelf/issues/74)) ([c2960b7](https://github.com/pantoninho/keyshelf/commit/c2960b7b94270d9b27914e4bd7bc3bf6afc8f04a))

## [4.4.0](https://github.com/pantoninho/keyshelf/compare/keyshelf-v4.3.0...keyshelf-v4.4.0) (2026-04-27)


### Features

* monorepo + keyshelf-action (closes [#64](https://github.com/pantoninho/keyshelf/issues/64)) ([#65](https://github.com/pantoninho/keyshelf/issues/65)) ([c49b6ae](https://github.com/pantoninho/keyshelf/commit/c49b6aea06f5a0f019d1cbfa913f8f78c22f5c39))

## [4.3.0](https://github.com/pantoninho/keyshelf/compare/v4.2.1...v4.3.0) (2026-04-21)


### Features

* support template syntax in app mapping files ([#62](https://github.com/pantoninho/keyshelf/issues/62)) ([f978a1f](https://github.com/pantoninho/keyshelf/commit/f978a1fe65bd9a7ed4264b49182edd661531b0bd))

## [4.2.1](https://github.com/pantoninho/keyshelf/compare/v4.2.0...v4.2.1) (2026-04-16)


### Bug Fixes

* resolve provider config paths relative to project root ([#60](https://github.com/pantoninho/keyshelf/issues/60)) ([22b6892](https://github.com/pantoninho/keyshelf/commit/22b689239154fec533035412a61495334a32dae7))

## [4.2.0](https://github.com/pantoninho/keyshelf/compare/v4.1.0...v4.2.0) (2026-04-10)


### Features

* resolve keys in parallel ([#58](https://github.com/pantoninho/keyshelf/issues/58)) ([ab825f7](https://github.com/pantoninho/keyshelf/commit/ab825f7055442f16854deb2cbae1b97002cee6b4))

## [4.1.0](https://github.com/pantoninho/keyshelf/compare/v4.0.3...v4.1.0) (2026-04-08)


### Features

* add sops provider ([#55](https://github.com/pantoninho/keyshelf/issues/55)) ([03c9c31](https://github.com/pantoninho/keyshelf/commit/03c9c31c77a789b45aca25c79d57760d47cf1512))

## [4.0.3](https://github.com/pantoninho/keyshelf/compare/v4.0.2...v4.0.3) (2026-04-08)


### Bug Fixes

* expand ~ in identityFile and secretsDir paths ([#53](https://github.com/pantoninho/keyshelf/issues/53)) ([eb80c5a](https://github.com/pantoninho/keyshelf/commit/eb80c5a301ac801adeeee629d9e26f5304101965))

## [4.0.2](https://github.com/pantoninho/keyshelf/compare/v4.0.1...v4.0.2) (2026-04-02)


### Bug Fixes

* show actionable error message for GCP authentication failures ([#50](https://github.com/pantoninho/keyshelf/issues/50)) ([90a7a4b](https://github.com/pantoninho/keyshelf/commit/90a7a4baffa8cbc9e78b95a6fc0cbf1604959669))

## [4.0.1](https://github.com/pantoninho/keyshelf/compare/v4.0.0...v4.0.1) (2026-03-26)


### Bug Fixes

* make app mapping file optional when using --env ([#45](https://github.com/pantoninho/keyshelf/issues/45)) ([5438ada](https://github.com/pantoninho/keyshelf/commit/5438ada153ff8ff92bda26e4964963d8d7d331f1))
* use default env provider for secret keys in set and import commands ([#48](https://github.com/pantoninho/keyshelf/issues/48)) ([3c9861f](https://github.com/pantoninho/keyshelf/commit/3c9861f7088cc91be4bd65a14c89d4febadb0f67))

## [4.0.0](https://github.com/pantoninho/keyshelf/compare/v3.0.2...v4.0.0) (2026-03-25)


### ⚠ BREAKING CHANGES

* rewrite keyshelf with monorepo-first architecture ([#43](https://github.com/pantoninho/keyshelf/issues/43))

### Features

* rewrite keyshelf with monorepo-first architecture ([#43](https://github.com/pantoninho/keyshelf/issues/43)) ([1681a57](https://github.com/pantoninho/keyshelf/commit/1681a57f4be1a6ac7547ef0ea7b96b92ed4c369b))

## [3.0.2](https://github.com/pantoninho/keyshelf/compare/v3.0.1...v3.0.2) (2026-03-24)


### Bug Fixes

* drop `projects/` prefix from gcsm references ([#41](https://github.com/pantoninho/keyshelf/issues/41)) ([59eee66](https://github.com/pantoninho/keyshelf/commit/59eee66b09ebd122b410573720c54db64d77b97d))

## [3.0.1](https://github.com/pantoninho/keyshelf/compare/v3.0.0...v3.0.1) (2026-03-24)


### Bug Fixes

* add repository url to package.json for npm provenance ([0ed7305](https://github.com/pantoninho/keyshelf/commit/0ed7305b7a01d87ec3b99ce55396c80085b1627e))

## [3.0.0](https://github.com/pantoninho/keyshelf/compare/v2.1.0...v3.0.0) (2026-03-24)


### ⚠ BREAKING CHANGES

* The `!pulumi` YAML tag and `pulumi` config field are no longer supported. Migrate pulumi stack outputs to plain strings or another provider before upgrading.
* Complete API and CLI rewrite. Not backwards compatible with v2.

### Features

* add `ls` command to list keys and their environments ([#38](https://github.com/pantoninho/keyshelf/issues/38)) ([daafa51](https://github.com/pantoninho/keyshelf/commit/daafa51eaa171ea42de3bd1f822c5fe9fb9b4cf5))
* add `rm` command to remove secrets and config values ([6e5f702](https://github.com/pantoninho/keyshelf/commit/6e5f7021c4d4f7c1573855a22bddf2365e4a3f78))
* add `rm` command to remove secrets and config values ([#34](https://github.com/pantoninho/keyshelf/issues/34)) ([9ab1ee3](https://github.com/pantoninho/keyshelf/commit/9ab1ee3c8f94ac084d208eb75e7f81d6f44f024a))
* remove pulumi provider ([#35](https://github.com/pantoninho/keyshelf/issues/35)) ([94b5553](https://github.com/pantoninho/keyshelf/commit/94b55530a80e6efa839a66e4f3bdde7becfa8f83))
* rewrite keyshelf v3 ([#33](https://github.com/pantoninho/keyshelf/issues/33)) ([8a7b810](https://github.com/pantoninho/keyshelf/commit/8a7b810829156796f5b36b80542719cd5f931894))
* support .env.keyshelf mapping file for custom env var names ([#39](https://github.com/pantoninho/keyshelf/issues/39)) ([313b5d2](https://github.com/pantoninho/keyshelf/commit/313b5d2235e29a4882d7d737ffcf1c931b2a9090))


### Bug Fixes

* rm command now deletes secrets from providers ([#36](https://github.com/pantoninho/keyshelf/issues/36)) ([7b93da3](https://github.com/pantoninho/keyshelf/commit/7b93da3d872617c0584d4137bcfbf2ac3a6b5b74))
