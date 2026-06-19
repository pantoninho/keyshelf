import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {parseDocument} from 'yaml'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {loadEnvironment} from '../../src/loader.js'
import {secretRefForm, setConfigValue, setSecretRef} from '../../src/set.js'

describe('secretRefForm', () => {
  it('is bare when the adapter ref equals the convention name', () => {
    expect(secretRefForm('myapp-web-staging-DB', 'myapp-web-staging-DB')).toEqual({bare: true})
  })

  it('is bare when the adapter returns undefined (convention-resolvable)', () => {
    expect(secretRefForm(undefined, 'myapp-web-staging-DB')).toEqual({bare: true})
  })

  it('carries an explicit { ref } when the adapter ref is foreign', () => {
    expect(secretRefForm('shared-db-url', 'myapp-web-staging-DB')).toEqual({bare: false, ref: 'shared-db-url'})
  })

  it('carries an explicit { ref } when the adapter returns a non-string payload', () => {
    expect(secretRefForm({name: 'x'}, 'myapp-web-staging-DB')).toEqual({bare: false, ref: {name: 'x'}})
  })
})

describe('setConfigValue', () => {
  it('sets a plaintext value under keys, creating keys when absent', () => {
    const doc = parseDocument('provider: local\n')
    setConfigValue(doc, 'REGION', 'eu-west-1')
    expect(doc.toString()).toContain('REGION: eu-west-1')
    expect(doc.toString()).toContain('provider: local')
  })

  it('overwrites an existing key and preserves the other keys and provider', () => {
    const doc = parseDocument('provider: local\nkeys:\n  LOG_LEVEL: info\n  REGION: us\n')
    setConfigValue(doc, 'REGION', 'eu')
    const text = doc.toString()
    expect(text).toContain('LOG_LEVEL: info')
    expect(text).toContain('REGION: eu')
    expect(text).toContain('provider: local')
    expect(text).not.toContain('REGION: us')
  })

  it('round-trips an adversarial value with spaces, = and quotes', () => {
    const value = 'a "quoted" = value with spaces'
    const doc = parseDocument('provider: local\nkeys:\n  OTHER: keep\n')
    setConfigValue(doc, 'TRICKY', value)
    const reparsed = parseDocument(doc.toString()).toJS() as {keys: Record<string, string>}
    expect(reparsed.keys.TRICKY).toBe(value)
    expect(reparsed.keys.OTHER).toBe('keep')
  })

  it('clears any prior !secret tag when re-setting a key as plaintext', () => {
    const doc = parseDocument('provider: local\nkeys:\n  DB: !secret\n')
    setConfigValue(doc, 'DB', 'plain')
    const reparsed = parseDocument(doc.toString())
    expect(reparsed.toString()).not.toContain('!secret')
    expect((reparsed.toJS() as {keys: Record<string, string>}).keys.DB).toBe('plain')
  })
})

describe('setSecretRef', () => {
  it('writes a bare !secret tag, never the value, preserving other keys', () => {
    const doc = parseDocument('provider: local\nkeys:\n  REGION: eu\n')
    setSecretRef(doc, 'DB', {bare: true})
    const text = doc.toString()
    expect(text).toContain('REGION: eu')
    expect(text).toContain('!secret')
    expect(text).not.toContain('s3cr3t')
  })

  it('writes !secret { ref: ... } for a foreign reference', () => {
    const doc = parseDocument('provider: local\nkeys:\n  REGION: eu\n')
    setSecretRef(doc, 'DB', {bare: false, ref: 'shared-db-url'})
    const reparsed = parseDocument(doc.toString())
    // The written form must round-trip back through the loader's !secret parsing.
    expect(reparsed.toString()).toContain('!secret')
    expect(reparsed.toString()).toContain('shared-db-url')
  })
})

// The written environment file must read back through the real loader into the
// expected EnvironmentValue: plaintext config, bare secret, and explicit ref.
describe('set output round-trips through loadEnvironment', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'keyshelf-set-loader-'))
    await mkdir(path.join(root, '.keyshelf', 'web'), {recursive: true})
    await writeFile(
      path.join(root, '.keyshelf', 'config.yaml'),
      'project: myapp\nproviders:\n  store:\n    adapter: fake\n',
      'utf8',
    )
    await writeFile(
      path.join(root, '.keyshelf', 'web', 'schema.yaml'),
      'keys:\n  REGION: !optional\n  DB: !optional\n',
      'utf8',
    )
  })

  afterEach(async () => {
    await rm(root, {recursive: true, force: true})
  })

  async function writeEnvVia(mutate: (doc: ReturnType<typeof parseDocument>) => void): Promise<void> {
    const doc = parseDocument('provider: store\nkeys:\n  REGION: eu\n')
    mutate(doc)
    await writeFile(path.join(root, '.keyshelf', 'web', 'staging.yaml'), doc.toString(), 'utf8')
  }

  it('yields a config EnvironmentValue for a plaintext set', async () => {
    await writeEnvVia((doc) => setConfigValue(doc, 'DB', 'plainval'))
    const loaded = await loadEnvironment(root, 'web', 'staging')
    expect(loaded.environment.keys.DB).toEqual({kind: 'config', value: 'plainval'})
  })

  it('yields a bare secret EnvironmentValue for set --secret (no ref)', async () => {
    await writeEnvVia((doc) => setSecretRef(doc, 'DB', {bare: true}))
    const loaded = await loadEnvironment(root, 'web', 'staging')
    expect(loaded.environment.keys.DB.kind).toBe('secret')
    expect(loaded.environment.keys.DB.ref).toBeUndefined()
  })

  it('yields a secret EnvironmentValue carrying the explicit ref', async () => {
    await writeEnvVia((doc) => setSecretRef(doc, 'DB', {bare: false, ref: 'shared-db-url'}))
    const loaded = await loadEnvironment(root, 'web', 'staging')
    expect(loaded.environment.keys.DB.kind).toBe('secret')
    expect(loaded.environment.keys.DB.ref).toMatchObject({ref: 'shared-db-url'})
  })
})
