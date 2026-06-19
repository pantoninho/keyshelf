import {execFile} from 'node:child_process'
import {existsSync} from 'node:fs'
import {mkdir, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {promisify} from 'node:util'
import {KeyshelfError} from '../errors.js'
import type {Adapter} from './adapter.js'
import {resolveSopsBinary} from './sops-binary.js'

const execFileAsync = promisify(execFile)

/**
 * The sops adapter (ADR-0002, ADR-0003). It owns no cryptography of its own —
 * every encrypt/decrypt is a shell-out to the `sops` binary, which Keyshelf
 * resolves from a bundled per-platform package first and any `sops` on PATH as a
 * fallback ({@link resolveSopsBinary}). Recipients are governed entirely by the
 * project's native `.sops.yaml`; Keyshelf never writes or mutates it.
 *
 * **Store.** A per-environment sibling encrypted file
 * `.keyshelf/{shelf}/{env}.secrets.yaml`, committed and encrypted. It holds a
 * flat `key -> value` mapping. Because sops and YAML can mangle multiline and
 * whitespace-bearing scalars, every value is carried as a JSON string inside the
 * store: `write` uses `sops set` with `JSON.stringify(value)` and `resolve`
 * decrypts with `--output-type json` and `JSON.parse`s the result, which makes
 * the write→resolve round-trip byte-exact for adversarial values (newlines,
 * trailing whitespace, `=`, quotes, unicode, multi-KB blobs, empty string).
 *
 * **Reference.** Convention resolution is by key name: `write(key, value)` stores
 * under `key` and returns `key` as the canonical reference, so a matching `set`
 * records a bare `!secret`. An explicit `!secret { ref: NAME }` resolves a
 * differently-named entry in the same store.
 *
 * **Error mapping** (uniform across adapters, ADR-0005):
 * - binary missing/unusable → `ADAPTER_UNAVAILABLE`;
 * - decryption-key/credential failure → `PROVIDER_AUTH`;
 * - key absent from the store → `SECRET_NOT_FOUND`;
 * - any other sops/IO failure → `ADAPTER_ERROR`.
 */
export class SopsAdapter implements Adapter {
  /** Absolute path to the per-environment encrypted store. */
  private readonly storePath: string
  /** Directory sops runs in, so it discovers the project's `.sops.yaml`. */
  private readonly cwd: string

  constructor(opts: {storePath: string; cwd: string}) {
    this.storePath = opts.storePath
    this.cwd = opts.cwd
  }

  async resolve(key: string, ref?: unknown): Promise<string> {
    const name = ref === undefined ? key : refName(ref)
    const store = await this.decryptStore()
    if (!Object.prototype.hasOwnProperty.call(store, name)) {
      throw new KeyshelfError('SECRET_NOT_FOUND', `No secret stored for '${name}' in '${this.storePath}'.`, {
        key,
        ref: name,
        file: this.storePath,
      })
    }

    return store[name]
  }

  async write(key: string, value: string): Promise<unknown> {
    await this.ensureStore()
    // `sops set` mutates the encrypted file in place, re-encrypting under the
    // recipients its `.sops.yaml` creation rules define. The value is carried as
    // a JSON string so it survives the YAML round-trip byte-exactly.
    await this.sops(['set', this.storePath, `["${jsonPathSegment(key)}"]`, JSON.stringify(value)])
    // The value is stored under the key itself, which is exactly how `resolve`
    // finds it by convention — so a convention write records a *bare* `!secret`
    // (the contract lets `write` return `undefined` for this). A foreign
    // environment can still reference the value explicitly via
    // `!secret { ref: <key> }`, which `resolve` honours.
    return undefined
  }

  /**
   * Decrypt the whole store to a flat `name -> value` map. A non-existent store
   * means nothing has been written yet, so every key is `SECRET_NOT_FOUND` —
   * represented here as an empty map (the caller raises the structured error).
   */
  private async decryptStore(): Promise<Record<string, string>> {
    if (!existsSync(this.storePath)) return {}
    const {stdout} = await this.sops(['decrypt', '--output-type', 'json', this.storePath])
    let parsed: unknown
    try {
      parsed = JSON.parse(stdout)
    } catch (error) {
      throw new KeyshelfError('ADAPTER_ERROR', `sops produced unparseable output for '${this.storePath}': ${String(error)}`, {
        file: this.storePath,
      })
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new KeyshelfError('ADAPTER_ERROR', `sops store '${this.storePath}' is not a mapping.`, {file: this.storePath})
    }

    // Every value was stored via JSON.stringify, so it decrypts back to a JSON
    // string; coerce non-string scalars defensively.
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      out[k] = typeof v === 'string' ? v : String(v)
    }

    return out
  }

  /**
   * Ensure the encrypted store exists, creating an empty encrypted file on first
   * write. The new file is an empty YAML mapping encrypted in place, so sops
   * applies the project's `.sops.yaml` creation rules (recipients) to it.
   */
  private async ensureStore(): Promise<void> {
    if (existsSync(this.storePath)) return
    await mkdir(path.dirname(this.storePath), {recursive: true})
    // An empty JSON object is a valid empty YAML mapping; sops encrypts it in
    // place under the recipients its creation rules resolve for this path.
    await writeFile(this.storePath, '{}\n', 'utf8')
    await this.sops(['encrypt', '--in-place', '--input-type', 'yaml', this.storePath])
  }

  /** Run sops, translating spawn/exit failures into the structured error codes. */
  private async sops(args: string[]): Promise<{stdout: string; stderr: string}> {
    const bin = resolveSopsBinary()
    try {
      const {stdout, stderr} = await execFileAsync(bin, args, {
        cwd: this.cwd,
        maxBuffer: 64 * 1024 * 1024,
      })
      return {stdout, stderr}
    } catch (error) {
      throw mapSopsError(error, this.storePath)
    }
  }
}

/** A failed `execFile`, narrowed to the fields we map on. */
interface ExecError {
  code?: number | string
  stderr?: string | Buffer
  message?: string
}

/**
 * Translate a failed sops invocation into a structured {@link KeyshelfError}.
 * The binary itself is resolved up front ({@link resolveSopsBinary}), so a spawn
 * `ENOENT` here means the resolved path vanished between resolution and exec —
 * still `ADAPTER_UNAVAILABLE`. sops exits non-zero with diagnostic stderr for
 * everything else; we key on its decryption-key signals for `PROVIDER_AUTH` and
 * fall back to `ADAPTER_ERROR`.
 */
function mapSopsError(error: unknown, file: string): KeyshelfError {
  const e = error as ExecError
  const stderr = e.stderr === undefined ? '' : e.stderr.toString()

  if (e.code === 'ENOENT') {
    return new KeyshelfError('ADAPTER_UNAVAILABLE', `The 'sops' binary could not be executed: ${e.message ?? 'ENOENT'}.`, {
      file,
    })
  }

  // sops reports a decryption-key/credential failure when no configured key can
  // recover the data key. These are the user's credential problem → PROVIDER_AUTH.
  if (isAuthFailure(stderr)) {
    return new KeyshelfError('PROVIDER_AUTH', `sops could not decrypt '${file}': no usable decryption key. ${firstLine(stderr)}`, {
      file,
    })
  }

  return new KeyshelfError('ADAPTER_ERROR', `sops failed on '${file}': ${firstLine(stderr) || e.message || 'unknown error'}`, {
    file,
  })
}

/** Heuristic over sops stderr identifying a missing/wrong decryption key. */
function isAuthFailure(stderr: string): boolean {
  const s = stderr.toLowerCase()
  return (
    s.includes('data key') ||
    s.includes('no identity matched') ||
    s.includes('no master key') ||
    s.includes('master key was able to decrypt') ||
    s.includes('did not find keys')
  )
}

/** The first non-empty line of a multi-line diagnostic, for terse messages. */
function firstLine(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length > 0) return trimmed
  }

  return ''
}

/** Coerce an explicit `!secret` ref payload to the stored name string. */
function refName(ref: unknown): string {
  if (typeof ref === 'string') return ref
  if (ref && typeof ref === 'object' && 'ref' in ref && typeof (ref as {ref: unknown}).ref === 'string') {
    return (ref as {ref: string}).ref
  }

  throw new KeyshelfError('ADAPTER_ERROR', `sops adapter: unsupported !secret ref payload: ${JSON.stringify(ref)}`, {ref})
}

/** Escape a key for embedding inside the `["KEY"]` JSON path sops set expects. */
function jsonPathSegment(key: string): string {
  return key.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
