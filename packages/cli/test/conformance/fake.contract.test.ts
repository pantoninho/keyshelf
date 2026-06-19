import { FakeAdapter, inMemoryStore } from "../../src/adapters/fake.js";
import { runAdapterContractSuite } from "./adapter-contract.js";

// The fake harness: the only fake-aware code. It provisions a fresh in-memory
// store + adapter per test and tears it down by discarding it. A new adapter
// runs the identical suite by supplying its own harness here.
runAdapterContractSuite({
  name: "fake",
  async setup() {
    return { adapter: new FakeAdapter(inMemoryStore()) };
  },
  async teardown() {
    // Nothing to clean up: the in-memory store is dropped with the adapter.
  }
});
