# Changelog

## [1.0.0](https://github.com/pantoninho/keyshelf/compare/migrate-v0.1.0...migrate-v1.0.0) (2026-05-03)


### ⚠ BREAKING CHANGES

* keyshelf no longer reads keyshelf.yaml or .keyshelf/<env>.yaml. Projects must migrate to keyshelf.config.ts (see @keyshelf/migrate). The keyshelf-next bin, the keyshelf/v5 and keyshelf/bin-next package exports, and the v4 GCP secret-id migrator (keyshelf migrate-gcp) are gone.

### Features

* v5 cutover (phase 8 in [#78](https://github.com/pantoninho/keyshelf/issues/78)) ([#100](https://github.com/pantoninho/keyshelf/issues/100)) ([98b1893](https://github.com/pantoninho/keyshelf/commit/98b1893b4671f74ed21aed5a63091ba640994d35))
* **v5:** add standalone v4 migrator ([#98](https://github.com/pantoninho/keyshelf/issues/98)) ([296089e](https://github.com/pantoninho/keyshelf/commit/296089e2a7f63a9ca4dc2582f8f155a26c609232))
