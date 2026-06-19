import {Command} from '@oclif/core'
import {KeyshelfError} from './errors.js'

/**
 * Base for every Keyshelf command.
 *
 * - `enableJsonFlag` adds `--json`; when set, a command's returned value is
 *   printed as JSON to stdout by oclif.
 * - `catch` renders a {@link KeyshelfError} as the structured error contract
 *   (`{ "error": { code, message, ...fields } }` in `--json` mode, a terse
 *   `error[CODE]: message` line on stderr otherwise) and exits non-zero.
 *   Framework errors (bad flags, `--help`) fall through to oclif's defaults.
 */
export abstract class BaseCommand extends Command {
  static enableJsonFlag = true

  protected async catch(err: Error & {exitCode?: number}): Promise<unknown> {
    if (err instanceof KeyshelfError) {
      if (this.jsonEnabled()) {
        process.stdout.write(`${JSON.stringify({error: err.toJSON()})}\n`)
      } else {
        process.stderr.write(`error[${err.code}]: ${err.message}\n`)
      }

      return this.exit(1)
    }

    return super.catch(err)
  }
}
