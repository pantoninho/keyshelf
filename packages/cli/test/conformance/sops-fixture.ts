import {execFile, execFileSync} from 'node:child_process'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {promisify} from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Whether a usable `sops` binary is resolvable on this host. The hermetic sops
 * conformance + E2E suites require both `sops` and `age-keygen`; when either is
 * genuinely absent (a dev box without them) the suites skip so local `npm test`
 * stays green. CI installs a pinned sops + age and asserts they are present, so
 * the matrix actually runs there rather than silently skipping.
 */
export function sopsAvailable(): boolean {
  return onPath('sops') && onPath('age-keygen')
}

function onPath(bin: string): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [bin], {stdio: 'ignore'})
    return true
  } catch {
    return false
  }
}

/**
 * A hermetic sops backend for the conformance suites: a throwaway temp directory
 * holding a freshly-generated **age** keypair, a fixture `.sops.yaml` whose
 * creation rules point at that age recipient for `*.secrets.yaml`, and an
 * isolated store directory. `SOPS_AGE_KEY_FILE` is set so sops can decrypt. Tear
 * down by removing the directory.
 *
 * This proves sops satisfies the shared contract end to end without touching the
 * developer's real keys or `.sops.yaml` (recipients are the user's concern,
 * ADR-0002): the fixture generates its own.
 */
export interface SopsFixture {
  /** The throwaway project root (where `.sops.yaml` and `.keyshelf/` live). */
  readonly dir: string
  /** Absolute path to the generated age key file. */
  readonly ageKeyFile: string
  /** The public age recipient the fixture encrypts to. */
  readonly recipient: string
  /** Remove the temp directory. */
  teardown(): Promise<void>
}

/**
 * Create a hermetic sops backend. `pathRegex` governs which files the creation
 * rule matches (default: any `*.secrets.yaml`). The caller is responsible for
 * setting `process.env.SOPS_AGE_KEY_FILE` if it spawns sops in a child process;
 * for in-process adapter use, set it from {@link SopsFixture.ageKeyFile}.
 */
export async function makeSopsFixture(pathRegex = String.raw`.*\.secrets\.yaml$`): Promise<SopsFixture> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'keyshelf-sops-'))
  const ageKeyFile = path.join(dir, 'age-key.txt')

  // Generate a throwaway age keypair into the fixture directory.
  const {stderr} = await execFileAsync('age-keygen', ['-o', ageKeyFile])
  // age-keygen prints `Public key: age1...` on stderr.
  const match = /public key:\s*(age1[0-9a-z]+)/i.exec(stderr)
  if (match === null) {
    throw new Error(`could not parse age public key from age-keygen output: ${stderr}`)
  }

  const recipient = match[1]

  // A fixture .sops.yaml the adapter never writes — recipients are the user's
  // concern; here the fixture plays that role with its own throwaway recipient.
  await writeFile(
    path.join(dir, '.sops.yaml'),
    `creation_rules:\n  - path_regex: ${pathRegex}\n    age: ${recipient}\n`,
    'utf8',
  )

  return {
    dir,
    ageKeyFile,
    recipient,
    async teardown() {
      await rm(dir, {recursive: true, force: true})
    },
  }
}
