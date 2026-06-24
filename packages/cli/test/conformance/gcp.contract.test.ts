import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { describe, it } from "vitest";
import { GcpAdapter } from "../../src/adapters/gcp.js";
import { runAdapterContractSuite } from "./adapter-contract.js";

// The gcp harness: the only gcp-aware code wiring the shared contract suite to
// real Google Cloud Secret Manager. There is no faithful local emulator
// (ADR-0005), so this runs *gated* — only when `KEYSHELF_GCP_TEST_PROJECT` names
// a real project to provision into (with ADC credentials present). Each test gets
// a fresh, uniquely-namespaced set of secrets that teardown deletes, so concurrent
// runs and reruns never collide. Without the env var the suite skips, keeping
// local `npm test` and per-PR CI green; the gated cadence (nightly on `main`)
// sets it and asserts the matrix genuinely runs.
const testProject = process.env.KEYSHELF_GCP_TEST_PROJECT;
const testLocation = process.env.KEYSHELF_GCP_TEST_LOCATION; // optional; default automatic replication

if (testProject) {
  const client = new SecretManagerServiceClient();
  // A per-run prefix keeps this run's secrets distinct from any other run sharing
  // the project; a per-test counter keeps each test within the run isolated too.
  const runPrefix = `ksconf-${process.pid}-${Date.now()}`;
  let counter = 0;
  let namespace = runPrefix;

  runAdapterContractSuite({
    name: "gcp",
    // Secret Manager rejects an empty payload and an empty secret has no native
    // form to mount, so the gcp adapter refuses empty values (ADR-0006).
    supportsEmptyValue: false,
    async setup() {
      counter += 1;
      namespace = `${runPrefix}-${counter}`;
      return {
        adapter: new GcpAdapter({
          projectId: testProject,
          namespace,
          location: testLocation,
          client: client as never
        })
      };
    },
    async teardown() {
      // Delete every secret this test created (those whose id carries the test's
      // unique namespace), leaving the shared project clean.
      const [secrets] = await client.listSecrets({
        parent: `projects/${testProject}`,
        filter: `name:${namespace}`
      });
      await Promise.all(
        secrets
          .filter((s) => secretId(s.name).startsWith(namespace))
          .map((s) => client.deleteSecret({ name: s.name as string }))
      );
    }
  });
} else {
  describe("adapter contract: gcp", () => {
    it.skip("skipped: set KEYSHELF_GCP_TEST_PROJECT to run against real Secret Manager", () => {});
  });
}

/** The short secret id (last path segment) of a `projects/.../secrets/ID` name. */
function secretId(name: string | null | undefined): string {
  if (!name) return "";
  const parts = name.split("/");
  return parts[parts.length - 1];
}
