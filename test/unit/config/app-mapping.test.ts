import { describe, it, expect } from "vitest";
import { parseAppMapping } from "../../../src/config/app-mapping.js";

describe("parseAppMapping", () => {
  it("parses simple mappings", () => {
    const content = "DB_HOST=db/host\nDB_PORT=db/port";
    expect(parseAppMapping(content)).toEqual([
      { envVar: "DB_HOST", keyPath: "db/host" },
      { envVar: "DB_PORT", keyPath: "db/port" }
    ]);
  });

  it("skips comments and blank lines", () => {
    const content = [
      "# Database config",
      "DB_HOST=db/host",
      "",
      "  ",
      "# API keys",
      "API_KEY=api/key"
    ].join("\n");
    expect(parseAppMapping(content)).toEqual([
      { envVar: "DB_HOST", keyPath: "db/host" },
      { envVar: "API_KEY", keyPath: "api/key" }
    ]);
  });

  it("trims whitespace around keys and values", () => {
    const content = "  DB_HOST  =  db/host  ";
    expect(parseAppMapping(content)).toEqual([{ envVar: "DB_HOST", keyPath: "db/host" }]);
  });

  it("handles values containing equals signs", () => {
    const content = "KEY=path/with=equals";
    expect(parseAppMapping(content)).toEqual([{ envVar: "KEY", keyPath: "path/with=equals" }]);
  });

  it("skips lines without equals sign", () => {
    const content = "INVALID_LINE\nDB_HOST=db/host";
    expect(parseAppMapping(content)).toEqual([{ envVar: "DB_HOST", keyPath: "db/host" }]);
  });

  it("skips lines with empty key or value", () => {
    const content = "=db/host\nDB_HOST=";
    expect(parseAppMapping(content)).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(parseAppMapping("")).toEqual([]);
  });
});
