import { describe, it, expect } from "vitest";
import { parseAppMapping, resolveTemplate } from "../../../src/config/app-mapping.js";

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

  it("parses template mappings with ${} syntax", () => {
    const content = "CLIENT_IDS=${google/web-client-id},${google/ios-client-id}";
    expect(parseAppMapping(content)).toEqual([
      {
        envVar: "CLIENT_IDS",
        template: "${google/web-client-id},${google/ios-client-id}",
        keyPaths: ["google/web-client-id", "google/ios-client-id"]
      }
    ]);
  });

  it("parses single template reference", () => {
    const content = "DB_URL=postgres://${db/host}:${db/port}/mydb";
    expect(parseAppMapping(content)).toEqual([
      {
        envVar: "DB_URL",
        template: "postgres://${db/host}:${db/port}/mydb",
        keyPaths: ["db/host", "db/port"]
      }
    ]);
  });

  it("mixes direct and template mappings", () => {
    const content = "DB_HOST=db/host\nDB_URL=postgres://${db/host}:${db/port}/mydb";
    const result = parseAppMapping(content);
    expect(result).toEqual([
      { envVar: "DB_HOST", keyPath: "db/host" },
      {
        envVar: "DB_URL",
        template: "postgres://${db/host}:${db/port}/mydb",
        keyPaths: ["db/host", "db/port"]
      }
    ]);
  });

  it("trims whitespace inside template references", () => {
    const content = "VAR=${ db/host }";
    expect(parseAppMapping(content)).toEqual([
      { envVar: "VAR", template: "${ db/host }", keyPaths: ["db/host"] }
    ]);
  });
});

describe("resolveTemplate", () => {
  it("resolves all references in a template", () => {
    const map = new Map([
      ["db/host", "localhost"],
      ["db/port", "5432"]
    ]);
    const { value, missing } = resolveTemplate("postgres://${db/host}:${db/port}/mydb", map);
    expect(value).toBe("postgres://localhost:5432/mydb");
    expect(missing).toEqual([]);
  });

  it("reports missing keys and substitutes empty string", () => {
    const map = new Map([["db/host", "localhost"]]);
    const { value, missing } = resolveTemplate("${db/host}:${db/port}", map);
    expect(value).toBe("localhost:");
    expect(missing).toEqual(["db/port"]);
  });

  it("handles template with no literal text", () => {
    const map = new Map([
      ["a", "1"],
      ["b", "2"]
    ]);
    const { value, missing } = resolveTemplate("${a}${b}", map);
    expect(value).toBe("12");
    expect(missing).toEqual([]);
  });
});
