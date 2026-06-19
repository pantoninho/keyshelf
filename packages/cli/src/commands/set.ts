import { Args, Flags } from "@oclif/core";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as readline from "node:readline/promises";
import { parseDocument } from "yaml";
import { createAdapter } from "../adapters/registry.js";
import { BaseCommand } from "../base-command.js";
import { KeyshelfError } from "../errors.js";
import { loadEnvironment } from "../loader.js";
import { secretRefForm, setConfigValue, setSecretRef } from "../set.js";
import { parseTarget } from "../target.js";

/** The structured result of a successful `set`. */
interface SetResult {
  key: string;
  environment: string;
  secret: boolean;
}

/**
 * Write a value into an environment. The value is read from stdin (or an
 * interactive prompt on a TTY) — never from argv, so a secret never appears in
 * process listings or shell history. The key must already be declared in the
 * shelf's schema (otherwise `UNKNOWN_KEY`); `set` never mutates the schema.
 *
 * Without `--secret` the value is written as plaintext into the environment file
 * under `keys: { KEY: value }`, editing the file surgically so the provider line
 * and every other key survive. With `--secret` the value is handed to the
 * environment's provider's adapter (`adapter.write`) and only a `!secret`
 * reference is recorded in the environment file — bare when the adapter's
 * returned reference matches the convention it resolves by, or an explicit
 * `!secret { ref: ... }` for a foreign reference. The plaintext value never
 * lands in the environment file.
 */
export default class Set extends BaseCommand {
  static description =
    "Write a value into a shelf/env. The value is read from stdin (or a prompt), never argv.";

  static examples = [
    "echo my-region | <%= config.bin %> set REGION web/staging",
    'printf "%s" "$PW" | <%= config.bin %> set DATABASE_PASSWORD web/staging --secret'
  ];

  static args = {
    key: Args.string({
      description: "The schema-declared key to set.",
      required: true
    }),
    target: Args.string({
      description: "The environment to write to, as <shelf>/<env>.",
      required: true
    })
  };

  static flags = {
    secret: Flags.boolean({
      description: "Store the value via the provider and record only a !secret reference.",
      default: false
    })
  };

  async run(): Promise<SetResult> {
    const { args, flags } = await this.parse(Set);
    const { shelf, env } = parseTarget(args.target);
    const { key } = args;

    // The value is never taken from argv. A TTY prompts; otherwise stdin is read
    // raw (byte-exact), and an empty stdin is NO_INPUT.
    const value = await this.readValue(key);

    const projectDir = process.cwd();
    // Loads config + schema + environment, surfacing NOT_INITIALIZED /
    // SHELF_NOT_FOUND / SCHEMA_NOT_FOUND / ENVIRONMENT_NOT_FOUND / MALFORMED_FILE.
    const loaded = await loadEnvironment(projectDir, shelf, env);

    // The key must already exist in the shelf's schema — set never declares keys.
    if (!Object.prototype.hasOwnProperty.call(loaded.schema.keys, key)) {
      throw new KeyshelfError(
        "UNKNOWN_KEY",
        `Key '${key}' is not declared in the schema for shelf '${shelf}'.`,
        {
          key,
          shelf,
          environment: `${shelf}/${env}`
        }
      );
    }

    // Edit the existing environment file in place, preserving every other key,
    // the provider line, and comments.
    const file = path.join(projectDir, ".keyshelf", shelf, `${env}.yaml`);
    const doc = parseDocument(await readFile(file, "utf8"));

    if (flags.secret) {
      await this.writeSecret(loaded, projectDir, shelf, env, key, value, doc);
    } else {
      setConfigValue(doc, key, value);
    }

    await writeFile(file, doc.toString(), "utf8");

    const result: SetResult = { key, environment: `${shelf}/${env}`, secret: flags.secret };
    if (!this.jsonEnabled()) {
      this.log(`Set ${result.environment} ${key}${flags.secret ? " (secret)" : ""}.`);
    }

    return result;
  }

  /**
   * Hand the value to the environment's provider's adapter, then record the
   * returned reference (bare or explicit) in the document. The provider is known
   * to exist from the loaded config; an unregistered adapter surfaces
   * `ADAPTER_UNAVAILABLE` from {@link createAdapter} before anything is written
   * to the file.
   */
  private async writeSecret(
    loaded: Awaited<ReturnType<typeof loadEnvironment>>,
    projectDir: string,
    shelf: string,
    env: string,
    key: string,
    value: string,
    doc: ReturnType<typeof parseDocument>
  ): Promise<void> {
    const provider = loaded.config.providers[loaded.environment.provider];
    if (provider === undefined) {
      throw new KeyshelfError(
        "PROVIDER_NOT_FOUND",
        `Environment '${shelf}/${env}' references undefined provider '${loaded.environment.provider}'.`,
        { shelf, environment: `${shelf}/${env}`, provider: loaded.environment.provider }
      );
    }

    const adapter = createAdapter(provider, {
      projectDir,
      project: loaded.config.project,
      shelf,
      env
    });
    const ref = await adapter.write(key, value);

    // The fake/reference convention names a secret `{project}-{shelf}-{env}-{key}`;
    // a returned ref matching that resolves by convention (bare !secret).
    const conventionRef = `${loaded.config.project}-${shelf}-${env}-${key}`;
    setSecretRef(doc, key, secretRefForm(ref, conventionRef));
  }

  /**
   * Obtain the value to write without ever touching argv. On an interactive TTY
   * we prompt; otherwise we read stdin to EOF and treat empty input as NO_INPUT.
   * The value is taken byte-exact — no trimming — to preserve fidelity.
   */
  private async readValue(key: string): Promise<string> {
    if (process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
      try {
        const entered = await rl.question(`Value for ${key}: `);
        if (entered === "") {
          throw noInput(key);
        }

        return entered;
      } finally {
        rl.close();
      }
    }

    const value = await readStdin();
    if (value.length === 0) {
      throw noInput(key);
    }

    return value;
  }
}

function noInput(key: string): KeyshelfError {
  return new KeyshelfError("NO_INPUT", `No value provided on stdin for '${key}'.`, { key });
}

/** Read all of stdin to EOF as a UTF-8 string, byte-exact. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}
