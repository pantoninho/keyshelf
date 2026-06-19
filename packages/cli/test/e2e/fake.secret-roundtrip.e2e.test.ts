import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {runSecretRoundtripSuite} from './secret-roundtrip.js'

// The fake harness: no backend prerequisites, a plaintext JSON store. Running the
// shared black-box suite against it keeps the fake faithful (ADR-0005) and is the
// fast per-PR lane that does not need a sops binary.
runSecretRoundtripSuite({
  name: 'fake',
  providerName: 'local',
  providerConfig() {
    return {local: {adapter: 'fake'}}
  },
  async setup() {
    // Nothing to provision.
  },
  runEnv() {
    return {}
  },
  async inspectStore(dir) {
    return readFile(path.join(dir, '.keyshelf', '.fake-store.json'), 'utf8')
  },
  async teardown() {
    // Nothing to tear down beyond the temp dir the suite removes.
  },
})
