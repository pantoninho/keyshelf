import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTmpDir, removeDir, runKeyshelf } from "./helpers.js";

/**
 * A per-adapter harness for the shared black-box E2E suite (ADR-0005). It is the
 * only adapter-aware code: it provisions the backend a project needs in a given
 * directory (for sops: a throwaway age key + fixture `.sops.yaml`; for fake:
 * nothing), declares the provider config the scaffolded project should reference,
 * and supplies any environment variables the spawned `keyshelf` process needs to
 * reach the backend (for sops: `SOPS_AGE_KEY_FILE`).
 */
export interface E2EHarness {
  /** A label for the test report (e.g. `'fake'`, `'sops'`). */
  readonly name: string;
  /** The provider name the scaffolded environment references. */
  readonly providerName: string;
  /** The `providers:` block written into `config.yaml`. */
  providerConfig(): Record<string, unknown>;
  /** Provision backend prerequisites in `dir` before the project runs. */
  setup(dir: string): Promise<void>;
  /** Env vars merged into each spawned `keyshelf` invocation. */
  runEnv(dir: string): Record<string, string>;
  /**
   * Read the raw on-disk store so the suite can assert it is ciphertext, not
   * plaintext. Omit for a backend with no inspectable local store.
   */
  inspectStore?(dir: string): Promise<string>;
  /** When true, the store must additionally look sops-encrypted (`ENC[`/`sops:`). */
  readonly expectEncrypted?: boolean;
  /** Tear down anything {@link setup} provisioned outside `dir`. */
  teardown(): Promise<void>;
}

/** A secret value with embedded newlines, `=`, quotes and unicode — exercises
 * byte-exact fidelity through the real binary, not just the contract suite. */
const ADVERSARIAL_SECRET = 'p@ss\nword="x=y"\ncafé 🔐';

/**
 * The shared, adapter-agnostic black-box E2E suite. It drives the real `keyshelf`
 * binary through the full secret round-trip — scaffold → declare a schema key →
 * `set --secret` (via stdin) → `run` asserts the wrapped command sees the value →
 * `validate` passes — plus the missing-secret error mapping. It knows nothing
 * about which adapter is behind it; the harness supplies the provider config and
 * backend setup/teardown, so the same scenarios run for `fake` and `sops` alike.
 */
export function runSecretRoundtripSuite(harness: E2EHarness): void {
  describe(`secret round-trip E2E: ${harness.name}`, () => {
    let cwd: string;

    beforeEach(async () => {
      cwd = await makeTmpDir();
      await harness.setup(cwd);
      await scaffold(cwd, harness);
    });

    afterEach(async () => {
      await removeDir(cwd);
      await harness.teardown();
    });

    const env = () => harness.runEnv(cwd);

    it("set --secret stores ciphertext, run injects the value, validate passes", async () => {
      const set = await runKeyshelf(
        ["set", "DATABASE_PASSWORD", "app/staging", "--secret", "--json"],
        {
          cwd,
          input: ADVERSARIAL_SECRET,
          env: env()
        }
      );
      expect(set.code, set.stderr).toBe(0);
      expect(JSON.parse(set.stdout)).toMatchObject({
        key: "DATABASE_PASSWORD",
        environment: "app/staging",
        secret: true
      });

      // The env file records only a !secret reference — never the plaintext.
      const envText = await readFile(path.join(cwd, ".keyshelf", "app", "staging.yaml"), "utf8");
      expect(envText).toContain("!secret");
      expect(envText).not.toContain("café");

      // Inspection hook: the on-disk store is ciphertext, not plaintext.
      await expectStoreEncrypted(cwd, harness, ADVERSARIAL_SECRET);

      // run injects the resolved secret; the child sees it byte-exact.
      const run = await runKeyshelf(
        [
          "run",
          "app/staging",
          "--",
          "node",
          "-e",
          "process.stdout.write(String(process.env.DATABASE_PASSWORD))"
        ],
        { cwd, env: env() }
      );
      expect(run.code, run.stderr).toBe(0);
      expect(run.stdout).toBe(ADVERSARIAL_SECRET);

      // validate passes once every required key is supplied.
      const validate = await runKeyshelf(["validate", "app/staging", "--json"], {
        cwd,
        env: env()
      });
      expect(validate.code, validate.stderr).toBe(0);
      expect(JSON.parse(validate.stdout)).toMatchObject({
        environment: "app/staging",
        valid: true
      });
    });

    it("run surfaces SECRET_NOT_FOUND when a !secret reference has no stored value", async () => {
      // Declare the environment as referencing a secret that was never written.
      await writeEnv(
        cwd,
        `provider: ${harness.providerName}\nkeys:\n  REGION: eu-west-1\n  DATABASE_PASSWORD: !secret\n`
      );
      const run = await runKeyshelf(
        ["run", "app/staging", "--", "node", "-e", 'process.stdout.write("ran")'],
        { cwd, env: env() }
      );
      expect(run.code).not.toBe(0);
      const json = await runKeyshelf(
        ["run", "app/staging", "--json", "--", "node", "-e", 'process.stdout.write("ran")'],
        { cwd, env: env() }
      );
      expect(JSON.parse(json.stdout).error.code).toBe("SECRET_NOT_FOUND");
      // Fail-fast: the wrapped command never ran.
      expect(json.stdout).not.toContain("ran");
    });
  });
}

const SCHEMA = `keys:
  REGION: !required
  DATABASE_PASSWORD: !required
`;

/** Scaffold a `.keyshelf/` project referencing the harness's provider. */
async function scaffold(cwd: string, harness: E2EHarness): Promise<void> {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const root = path.join(cwd, ".keyshelf");
  await mkdir(path.join(root, "app"), { recursive: true });

  const { stringify } = await import("yaml");
  await writeFile(
    path.join(root, "config.yaml"),
    stringify({ project: "myapp", providers: harness.providerConfig() }),
    "utf8"
  );
  await writeFile(path.join(root, "app", "schema.yaml"), SCHEMA, "utf8");
  await writeEnv(cwd, `provider: ${harness.providerName}\nkeys:\n  REGION: eu-west-1\n`);
}

async function writeEnv(cwd: string, contents: string): Promise<void> {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path.join(cwd, ".keyshelf", "app", "staging.yaml"), contents, "utf8");
}

/**
 * Assert the on-disk secret store is ciphertext, not plaintext: it must not
 * contain the plaintext secret, and (for the sops adapter) must look encrypted.
 * The fake store is plaintext JSON by design, so only the no-plaintext invariant
 * holds there — `expectEncrypted` lets each harness opt into the stronger check.
 */
async function expectStoreEncrypted(
  cwd: string,
  harness: E2EHarness,
  secret: string
): Promise<void> {
  const inspect = harness.inspectStore;
  if (inspect === undefined) return;
  const contents = await inspect(cwd);
  expect(contents).not.toContain(secret);
  if (harness.expectEncrypted) {
    expect(contents).toMatch(/ENC\[/);
    expect(contents).toContain("sops:");
  }
}
