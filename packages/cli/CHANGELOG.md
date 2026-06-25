# Changelog

## [6.5.0](https://github.com/pantoninho/keyshelf/compare/keyshelf-v6.4.0...keyshelf-v6.5.0) (2026-06-25)


### Features

* **sops:** expand ~/ in ageKeyFile to the user's home directory ([#252](https://github.com/pantoninho/keyshelf/issues/252)) ([e2e8de9](https://github.com/pantoninho/keyshelf/commit/e2e8de9d028e741806d202562a4af71837d71259))

## [6.4.0](https://github.com/pantoninho/keyshelf/compare/keyshelf-v6.3.1...keyshelf-v6.4.0) (2026-06-25)


### Features

* **sops:** add ageKeyFile provider field to locate the age decryption identity ([#250](https://github.com/pantoninho/keyshelf/issues/250)) ([60455ba](https://github.com/pantoninho/keyshelf/commit/60455baa853794befec8cc3886aece6b47170736))

## [6.3.1](https://github.com/pantoninho/keyshelf/compare/keyshelf-v6.3.0...keyshelf-v6.3.1) (2026-06-24)


### Bug Fixes

* **adapters:** make SECRET_NOT_FOUND legible, stop leaking storage address ([#247](https://github.com/pantoninho/keyshelf/issues/247)) ([0ef113d](https://github.com/pantoninho/keyshelf/commit/0ef113d0b122b1558e46ef430905c5c3cebda701))

## [6.3.0](https://github.com/pantoninho/keyshelf/compare/keyshelf-v6.2.0...keyshelf-v6.3.0) (2026-06-24)


### Features

* secret version pinning (require-deploy for secret changes) — ADR-0009 + impl ([#246](https://github.com/pantoninho/keyshelf/issues/246)) ([dc002df](https://github.com/pantoninho/keyshelf/commit/dc002dfb81e4298d23c80339d3cc3dd146b766b9))


### Bug Fixes

* **run:** forward termination signals to the wrapped child ([#244](https://github.com/pantoninho/keyshelf/issues/244)) ([5a8dc5e](https://github.com/pantoninho/keyshelf/commit/5a8dc5e22d2a7c45fd2560182c03fd751b06e550))

## [6.2.0](https://github.com/pantoninho/keyshelf/compare/keyshelf-v6.1.1...keyshelf-v6.2.0) (2026-06-24)


### Features

* **ls:** surface adapter metadata (offline secret address) ([#237](https://github.com/pantoninho/keyshelf/issues/237)) ([2e267d9](https://github.com/pantoninho/keyshelf/commit/2e267d9c4f68e533e33d723b9e07a796ef543a2a))

## [6.1.1](https://github.com/pantoninho/keyshelf/compare/keyshelf-v6.1.0...keyshelf-v6.1.1) (2026-06-24)


### ⚠ BREAKING CHANGES

* **gcp:** store secret values raw for native Secret Manager interop ([#233](https://github.com/pantoninho/keyshelf/issues/233))

### Features

* **gcp:** store secret values raw for native Secret Manager interop ([#233](https://github.com/pantoninho/keyshelf/issues/233)) ([d5a60cf](https://github.com/pantoninho/keyshelf/commit/d5a60cff785f5ade8408941bef3441f3bd7614ca))


### Miscellaneous Chores

* force release-please to cut 6.1.1 ([#238](https://github.com/pantoninho/keyshelf/issues/238)) ([4df18bf](https://github.com/pantoninho/keyshelf/commit/4df18bf26c490d6d20321b721096d1a37359fb1c))

## [6.1.0](https://github.com/pantoninho/keyshelf/compare/keyshelf-v6.0.0...keyshelf-v6.1.0) (2026-06-23)


### Features

* **cli:** keyshelf ls environment key view ([#229](https://github.com/pantoninho/keyshelf/issues/229)) ([2d68c77](https://github.com/pantoninho/keyshelf/commit/2d68c779efe6d38a91b40c6d2521fac87035ea38))
* **cli:** keyshelf ls project map ([#227](https://github.com/pantoninho/keyshelf/issues/227)) ([baa8fad](https://github.com/pantoninho/keyshelf/commit/baa8fad1fb2219db64633ec06ff6520de428cfe5))

## [6.0.0](https://github.com/pantoninho/keyshelf/compare/keyshelf-v5.4.0...keyshelf-v6.0.0) (2026-06-22)


### Features

* **init:** keyshelf init scaffolds config + AGENTS.md entry point ([#171](https://github.com/pantoninho/keyshelf/issues/171)) ([304931a](https://github.com/pantoninho/keyshelf/commit/304931aaad56ae70cf853e26983caa166391dc3c))
* make provider optional for secret-free environments ([#208](https://github.com/pantoninho/keyshelf/issues/208)) ([caa3c3c](https://github.com/pantoninho/keyshelf/commit/caa3c3cb3946b6e291c8e381870309d093203b81))
* resolve key references (!ref) at run ([#207](https://github.com/pantoninho/keyshelf/issues/207)) ([81223ec](https://github.com/pantoninho/keyshelf/commit/81223ec36f6f9c73636c1393ad7d5670fd6109b6))
* **run:** error on --map reference to an N/A key (ADR-0002) ([#164](https://github.com/pantoninho/keyshelf/issues/164)) ([40672b2](https://github.com/pantoninho/keyshelf/commit/40672b20b821391747ce89e182535c5b7ebe5b70))
* **set:** author key references via set --ref / --ref-key ([#209](https://github.com/pantoninho/keyshelf/issues/209)) ([2df8009](https://github.com/pantoninho/keyshelf/commit/2df8009fd37432cbcb45f655003a1e5cba3a8519))
* teach the fix in errors for the five agent mistakes ([#168](https://github.com/pantoninho/keyshelf/issues/168)) ([#172](https://github.com/pantoninho/keyshelf/issues/172)) ([2e5db79](https://github.com/pantoninho/keyshelf/commit/2e5db792fb1b8be08d905914e706c97c361001e0))
* **validate:** static, offline validation of key references ([#210](https://github.com/pantoninho/keyshelf/issues/210)) ([deefd43](https://github.com/pantoninho/keyshelf/commit/deefd438f629a53cebb8adc553f746a000c7d35e))
