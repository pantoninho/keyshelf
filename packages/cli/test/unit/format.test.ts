import { describe, expect, it } from "vitest";
import { formatSkipCause } from "../../src/index.js";

describe("formatSkipCause", () => {
  it("formats group-filter with active group list", () => {
    expect(formatSkipCause({ type: "group-filter", activeGroups: ["app", "ci"] })).toBe(
      "is filtered out by --group=app,ci"
    );
  });

  it("formats path-filter with active prefix list", () => {
    expect(formatSkipCause({ type: "path-filter", activePrefixes: ["db", "log/level"] })).toBe(
      "is filtered out by --filter=db,log/level"
    );
  });

  it("formats optional-no-value", () => {
    expect(formatSkipCause({ type: "optional-no-value" })).toBe("is optional and has no value");
  });

  it("formats optional-not-found", () => {
    expect(formatSkipCause({ type: "optional-not-found" })).toBe(
      "is optional and was not found in its provider"
    );
  });

  it("formats template-ref-unavailable recursively", () => {
    expect(
      formatSkipCause({
        type: "template-ref-unavailable",
        reference: "db/password",
        referenceCause: { type: "group-filter", activeGroups: ["app"] }
      })
    ).toBe("is unavailable: referenced key 'db/password' is filtered out by --group=app");
  });
});
