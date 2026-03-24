# Changelog

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
