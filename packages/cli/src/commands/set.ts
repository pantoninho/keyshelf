import { Args, Flags } from "@oclif/core";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as readline from "node:readline/promises";
import { parseDocument } from "yaml";
import { createAdapter } from "../adapters/registry.js";
import { conventionName } from "../adapters/shared.js";
import { BaseCommand } from "../base-command.js";
import { KeyshelfError } from "../errors.js";
import { loadEnvironment } from "../loader.js";
import { secretRefForm, setConfigValue, setKeyReference, setSecretRef } from "../set.js";
import { parseTarget } from "../target.js";
import type { KeyReference } from "../model.js";

/** The structured result of a successful `set`. */
interface SetResult {
  key: string;
  environment: string;
  secret: boolean;
  /** Whether a `!ref` key reference was authored (vs a value/secret written). */
  ref: boolean;
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
    "Write a value into a shelf/stage. The value is read from stdin (or a prompt), never argv.";

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
      description: "The environment to write to, as <shelf>/<stage>.",
      required: true
    })
  };

  static flags = {
    secret: Flags.boolean({
      description: "Store the value via the provider and record only a !secret reference.",
      default: false,
      exclusive: ["ref"]
    }),
    ref: Flags.string({
      description:
        "Author a !ref key reference to <shelf>[/<stage>] (offline file edit; no value, no provider).",
      exclusive: ["secret"]
    }),
    "ref-key": Flags.string({
      description: "The target key name for a rename; omitted from the node when equal to <KEY>.",
      dependsOn: ["ref"]
    })
  };

  async run(): Promise<SetResult> {
    const { args, flags } = await this.parse(Set);
    const { shelf, stage } = parseTarget(args.target);
    const { key } = args;

    if (flags.ref !== undefined) {
      return this.authorReference(shelf, stage, key, flags.ref, flags["ref-key"]);
    }

    // The value is never taken from argv. A TTY prompts; otherwise stdin is read
    // raw (byte-exact), and an empty stdin is NO_INPUT.
    const value = await this.readValue(key);

    const projectDir = process.cwd();
    // Loads config + schema + environment, surfacing NOT_INITIALIZED /
    // SHELF_NOT_FOUND / SCHEMA_NOT_FOUND / ENVIRONMENT_NOT_FOUND / MALFORMED_FILE.
    const loaded = await loadEnvironment(projectDir, shelf, stage);

    this.assertDeclared(loaded.schema.keys, key, shelf, stage);

    // Edit the existing environment file in place, preserving every other key,
    // the provider line, and comments.
    const file = path.join(projectDir, ".keyshelf", shelf, `${stage}.yaml`);
    const doc = parseDocument(await readFile(file, "utf8"));

    if (flags.secret) {
      await this.writeSecret(loaded, projectDir, shelf, stage, key, value, doc);
    } else {
      setConfigValue(doc, key, value);
    }

    await writeFile(file, doc.toString(), "utf8");

    const result: SetResult = {
      key,
      environment: `${shelf}/${stage}`,
      secret: flags.secret,
      ref: false
    };
    if (!this.jsonEnabled()) {
      this.log(`Set ${result.environment} ${key}${flags.secret ? " (secret)" : ""}.`);
    }

    return result;
  }

  /**
   * Author a `!ref` key reference into the consuming environment file — a pure
   * offline mutation (ADR-0007). No value is read from stdin and no provider's
   * adapter is touched: a key reference points at where the value lives, it does
   * not store one. The consuming key must still be declared in the consuming
   * shelf's schema (set never declares keys), and the environment file must exist;
   * both are checked by {@link loadEnvironment} + {@link assertDeclared}.
   *
   * `refSpec` is `<shelf>` or `<shelf>/<stage>`: a trailing `/<stage>` records an
   * explicit `stage:`, otherwise the target resolves at the current stage. A
   * `refKey` records a `key:` rename, except when it equals the consuming key (a
   * same-name "rename" is the loader's default, so it is not written).
   */
  private async authorReference(
    shelf: string,
    stage: string,
    key: string,
    refSpec: string,
    refKey: string | undefined
  ): Promise<SetResult> {
    const reference = parseRefSpec(refSpec);
    if (refKey !== undefined && refKey !== key) {
      reference.key = refKey;
    }

    const projectDir = process.cwd();
    // No provider/config beyond what loadEnvironment reads — no adapter is created.
    const loaded = await loadEnvironment(projectDir, shelf, stage);
    this.assertDeclared(loaded.schema.keys, key, shelf, stage);

    const file = path.join(projectDir, ".keyshelf", shelf, `${stage}.yaml`);
    const doc = parseDocument(await readFile(file, "utf8"));
    setKeyReference(doc, key, reference);
    await writeFile(file, doc.toString(), "utf8");

    const result: SetResult = {
      key,
      environment: `${shelf}/${stage}`,
      secret: false,
      ref: true
    };
    if (!this.jsonEnabled()) {
      this.log(`Set ${result.environment} ${key} (ref -> ${refSpec}).`);
    }

    return result;
  }

  /** Reject a key not declared in the consuming shelf's schema — set never declares keys. */
  private assertDeclared(
    schemaKeys: Record<string, unknown>,
    key: string,
    shelf: string,
    stage: string
  ): void {
    if (!Object.prototype.hasOwnProperty.call(schemaKeys, key)) {
      throw new KeyshelfError(
        "UNKNOWN_KEY",
        `Key '${key}' is not declared in the schema for shelf '${shelf}'.`,
        {
          key,
          shelf,
          environment: `${shelf}/${stage}`
        }
      );
    }
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
    stage: string,
    key: string,
    value: string,
    doc: ReturnType<typeof parseDocument>
  ): Promise<void> {
    const providerName = loaded.environment.provider;
    const provider = providerName === undefined ? undefined : loaded.config.providers[providerName];
    if (provider === undefined) {
      throw new KeyshelfError(
        "PROVIDER_NOT_FOUND",
        `Environment '${shelf}/${stage}' references undefined provider '${providerName}'.`,
        { shelf, environment: `${shelf}/${stage}`, provider: providerName }
      );
    }

    const adapter = createAdapter(provider, {
      projectDir,
      project: loaded.config.project,
      shelf,
      stage
    });
    const ref = await adapter.write(key, value);

    // The fake/reference convention names a secret
    // `keyshelf__{project}__{shelf}__{stage}__{key}`; a returned ref matching that
    // resolves by convention (bare !secret).
    const conventionRef = conventionName(
      `keyshelf__${loaded.config.project}__${shelf}__${stage}`,
      key
    );
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

/**
 * Parse a `--ref` spec into a {@link KeyReference}: `<shelf>` (current stage) or
 * `<shelf>/<stage>` (explicit stage). A malformed spec — empty shelf, empty
 * stage, or more than one `/` — is a `MALFORMED_FILE`, matching how
 * {@link parseTarget} rejects a bad environment address. The `key` field is added
 * by the caller for a rename; it is never derived from the spec.
 */
function parseRefSpec(spec: string): KeyReference {
  const slash = spec.indexOf("/");
  if (slash === -1) {
    if (spec.length === 0) throw malformedRef(spec);
    return { shelf: spec };
  }

  if (slash === 0 || slash === spec.length - 1 || spec.indexOf("/", slash + 1) !== -1) {
    throw malformedRef(spec);
  }

  return { shelf: spec.slice(0, slash), stage: spec.slice(slash + 1) };
}

function malformedRef(spec: string): KeyshelfError {
  return new KeyshelfError(
    "MALFORMED_FILE",
    `'${spec}' is not a valid --ref target; expected '<shelf>' or '<shelf>/<stage>'.`,
    { reason: "expected '<shelf>' or '<shelf>/<stage>'", target: spec }
  );
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
