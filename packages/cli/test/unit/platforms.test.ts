import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  loadSopsManifest,
  platformPackageJson,
  platforms,
  type PlatformKey
} from "../../scripts/lib/platforms.js";

const require = createRequire(import.meta.url);
const mainPkg = require("../../package.json") as {
  optionalDependencies: Record<string, string>;
};

describe("sops platform manifest", () => {
  it("lists exactly the five supported {platform}-{arch} targets", () => {
    expect([...platforms].sort()).toEqual(
      ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"].sort()
    );
  });

  it("has a sha256 and asset name for every platform", () => {
    const manifest = loadSopsManifest();
    for (const key of platforms) {
      const entry = manifest.binaries[key];
      expect(entry, key).toBeDefined();
      expect(entry.asset, key).toMatch(/^sops-v/);
      expect(entry.sha256, key).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("pins a single sops version that the tag agrees with", () => {
    const manifest = loadSopsManifest();
    expect(manifest.tag).toBe(`v${manifest.sopsVersion}`);
  });
});

describe("platformPackageJson", () => {
  const manifest = loadSopsManifest();

  it("derives the package version from the pinned sops version (clef-sh style)", () => {
    const pkg = platformPackageJson("linux-x64", manifest);
    expect(pkg.version).toBe(manifest.sopsVersion);
  });

  it("declares os/cpu matching the package name (load-bearing for npm selection)", () => {
    const cases: Array<[PlatformKey, string, string]> = [
      ["linux-x64", "linux", "x64"],
      ["linux-arm64", "linux", "arm64"],
      ["darwin-x64", "darwin", "x64"],
      ["darwin-arm64", "darwin", "arm64"],
      ["win32-x64", "win32", "x64"]
    ];
    for (const [key, os, cpu] of cases) {
      const pkg = platformPackageJson(key, manifest);
      expect(pkg.name, key).toBe(`@keyshelf/sops-${key}`);
      expect(pkg.os, key).toEqual([os]);
      expect(pkg.cpu, key).toEqual([cpu]);
    }
  });

  it("declares the keyshelf repository (required for --provenance; empty url => npm E422)", () => {
    for (const key of platforms) {
      expect(platformPackageJson(key, manifest).repository, key).toEqual({
        type: "git",
        url: "https://github.com/pantoninho/keyshelf"
      });
    }
  });

  it("redistributes sops, so its license is MPL-2.0 (not keyshelf MIT)", () => {
    for (const key of platforms) {
      expect(platformPackageJson(key, manifest).license, key).toBe("MPL-2.0");
    }
  });

  it("has no runtime dependencies (deps: none)", () => {
    for (const key of platforms) {
      const pkg = platformPackageJson(key, manifest);
      expect(pkg.dependencies, key).toBeUndefined();
      expect(pkg.optionalDependencies, key).toBeUndefined();
    }
  });

  it("ships only the bin directory and declares no npm bin command", () => {
    // These packages are binary *carriers* the resolver locates by path
    // (require.resolve + bin/sops[.exe]); they intentionally expose no `bin`
    // command, matching esbuild's @esbuild/* platform packages.
    for (const key of platforms) {
      const pkg = platformPackageJson(key, manifest);
      expect(pkg.files, key).toEqual(["bin"]);
      expect((pkg as Record<string, unknown>).bin, key).toBeUndefined();
    }
  });
});

describe("main package.json agreement", () => {
  const manifest = loadSopsManifest();

  it("pins every @keyshelf/sops-* optionalDependency to the bundled sops version", () => {
    for (const key of platforms) {
      const name = `@keyshelf/sops-${key}`;
      expect(mainPkg.optionalDependencies[name], name).toBe(manifest.sopsVersion);
    }
  });
});
