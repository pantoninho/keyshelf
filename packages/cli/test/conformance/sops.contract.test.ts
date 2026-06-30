import path from "node:path";
import { describe, it } from "vitest";
import { SopsAdapter } from "../../src/adapters/sops.js";
import { runAdapterContractSuite } from "./adapter-contract.js";
import { makeSopsFixture, sopsAvailable, type SopsFixture } from "./sops-fixture.js";

// The sops harness: the only sops-aware code wiring the shared contract suite to
// the real `sops` binary. Each test gets a fresh hermetic backend — a throwaway
// age key, a fixture `.sops.yaml`, and an isolated encrypted store — proving sops
// satisfies the identical contract as `fake`, including the error-mapping and
// value-fidelity dimensions baked into the suite.
//
// When no `sops`/`age` is resolvable (a dev box without them) the suite skips so
// local `npm test` stays green; CI installs both and asserts their presence, so
// the matrix genuinely runs there.
if (sopsAvailable()) {
  let fixture: SopsFixture;

  runAdapterContractSuite({
    name: "sops",
    // sops does not version its store — an encrypted file in the shelf's
    // `secrets/` directory holds one value, already deploy-gated by being
    // committed (ADR-0009). Pinning is N/A, so the
    // pinning cases are skipped for sops.
    supportsVersionPinning: false,
    async setup() {
      fixture = await makeSopsFixture();
      // Decryption needs the fixture's throwaway age key in the environment.
      process.env.SOPS_AGE_KEY_FILE = fixture.ageKeyFile;
      const storePath = path.join(fixture.dir, ".keyshelf", "app", "secrets", "staging.yaml");
      return { adapter: new SopsAdapter({ storePath, cwd: fixture.dir }) };
    },
    async teardown() {
      delete process.env.SOPS_AGE_KEY_FILE;
      await fixture.teardown();
    }
  });
} else {
  describe("adapter contract: sops", () => {
    it.skip("skipped: no sops/age binary resolvable on this host", () => {});
  });
}
