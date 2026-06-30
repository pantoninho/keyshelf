import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, it } from "vitest";
import { sopsAvailable } from "../conformance/sops-fixture.js";
import { runSecretRoundtripSuite } from "./secret-roundtrip.js";

const execFileAsync = promisify(execFile);

// The sops harness: provisions a throwaway age key + fixture `.sops.yaml` in the
// project directory so the real `keyshelf` binary, shelling out to sops, encrypts
// the store under the fixture's recipient. This runs the IDENTICAL black-box
// suite as `fake`, proving the full MVP flow (init/scaffold -> declare schema ->
// set --secret -> run) works end to end against sops, hermetically.
//
// Skips when no sops/age is resolvable so local `npm test` stays green; CI
// installs both and asserts their presence, so the matrix genuinely runs there.
if (sopsAvailable()) {
  let ageKeyFile = "";

  runSecretRoundtripSuite({
    name: "sops",
    providerName: "local",
    providerConfig() {
      return { local: { adapter: "sops" } };
    },
    async setup(dir) {
      ageKeyFile = path.join(dir, "age-key.txt");
      const { stderr } = await execFileAsync("age-keygen", ["-o", ageKeyFile]);
      const match = /public key:\s*(age1[0-9a-z]+)/i.exec(stderr);
      if (match === null) throw new Error(`could not parse age public key: ${stderr}`);

      // The fixture .sops.yaml the adapter never mutates — recipients are the
      // user's concern; here a throwaway recipient plays that role. sops walks up
      // from the store path to find it at the project root.
      await writeFile(
        path.join(dir, ".sops.yaml"),
        `creation_rules:\n  - path_regex: secrets/.*\\.yaml$\n    age: ${match[1]}\n`,
        "utf8"
      );
    },
    runEnv() {
      return { SOPS_AGE_KEY_FILE: ageKeyFile };
    },
    async inspectStore(dir) {
      return readFile(path.join(dir, ".keyshelf", "app", "secrets", "staging.yaml"), "utf8");
    },
    expectEncrypted: true,
    async teardown() {
      // The temp project dir (with the key) is removed by the suite.
    }
  });
} else {
  describe("secret round-trip E2E: sops", () => {
    it.skip("skipped: no sops/age binary resolvable on this host", () => {});
  });
}
