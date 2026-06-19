import {execFile} from 'node:child_process'
import {mkdtemp, rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'

const execFileAsync = promisify(execFile)

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const BIN = path.join(repoRoot, 'bin', 'run.js')

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/** Run the real built `keyshelf` binary as a subprocess. Never throws on a
 * non-zero exit — returns the captured code/stdout/stderr so tests can assert.
 * `env` is merged onto the inherited environment (e.g. `SOPS_AGE_KEY_FILE` so the
 * sops adapter can decrypt in the spawned process). */
export async function runKeyshelf(
  args: string[],
  opts: {cwd: string; input?: string; env?: Record<string, string>} = {cwd: process.cwd()},
): Promise<RunResult> {
  try {
    const child = execFileAsync('node', [BIN, ...args], {
      cwd: opts.cwd,
      env: opts.env === undefined ? process.env : {...process.env, ...opts.env},
    })
    if (opts.input !== undefined) {
      child.child.stdin?.end(opts.input)
    }

    const {stdout, stderr} = await child
    return {code: 0, stdout, stderr}
  } catch (error) {
    const e = error as {code?: number; stdout?: string; stderr?: string}
    return {code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? ''}
  }
}

/** Create an isolated empty temp directory to act as a project root. */
export async function makeTmpDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'keyshelf-e2e-'))
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, {recursive: true, force: true})
}
