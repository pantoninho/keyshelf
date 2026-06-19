import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assemblePackage, sha256, smokeTest, verifySha256 } from "../../scripts/lib/build.js";
import { loadSopsManifest, platformPackageJson, repoRoot } from "../../scripts/lib/platforms.js";

describe("sha256 integrity", () => {
  it("hashes bytes to the expected lowercase hex digest", () => {
    // echo -n hello | sha256sum
    expect(sha256(Buffer.from("hello"))).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
  });

  it("passes when the digest matches", () => {
    expect(() =>
      verifySha256(Buffer.from("hello"), sha256(Buffer.from("hello")), "x")
    ).not.toThrow();
  });

  it("throws a build-failing error when a byte is tampered", () => {
    const good = sha256(Buffer.from("hello"));
    expect(() => verifySha256(Buffer.from("hell0"), good, "sops-linux-x64")).toThrow(
      /checksum mismatch/i
    );
  });
});

describe("assemblePackage", () => {
  let tmp: string;
  const manifest = loadSopsManifest();

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "keyshelf-build-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("writes bin/sops (mode 0755) and the derived package.json for a unix target", async () => {
    const binary = Buffer.from("#!/bin/sh\necho fake sops\n");
    const outDir = path.join(tmp, "linux-x64");
    await assemblePackage("linux-x64", manifest, binary, outDir);

    const binPath = path.join(outDir, "bin", "sops");
    expect(await readFile(binPath)).toEqual(binary);
    const mode = (await stat(binPath)).mode & 0o777;
    expect(mode & 0o111).not.toBe(0); // executable bit set

    const pkg = JSON.parse(await readFile(path.join(outDir, "package.json"), "utf8"));
    expect(pkg).toMatchObject(platformPackageJson("linux-x64", manifest));
  });

  it("names the binary sops.exe for win32", async () => {
    const outDir = path.join(tmp, "win32-x64");
    await assemblePackage("win32-x64", manifest, Buffer.from("MZ"), outDir);
    expect(await readFile(path.join(outDir, "bin", "sops.exe"), "utf8")).toBe("MZ");
  });

  it("copies the sops LICENSE/notice so the redistribution carries MPL-2.0", async () => {
    const outDir = path.join(tmp, "linux-x64");
    await assemblePackage("linux-x64", manifest, Buffer.from("x"), outDir);
    const license = await readFile(path.join(outDir, "LICENSE"), "utf8");
    expect(license).toMatch(/Mozilla Public License/i);
  });
});

describe("host smoke-test against the real bundled binary", () => {
  it("runs sops --version on the assembled host binary when present", async () => {
    // Only meaningful once the host package has been generated; otherwise skip.
    const hostPkgJson = path.join(
      repoRoot,
      "platforms",
      `sops-${process.platform}-${process.arch}`,
      "package.json"
    );
    let exists = true;
    try {
      await stat(hostPkgJson);
    } catch {
      exists = false;
    }

    if (!exists) {
      expect(true).toBe(true);
      return;
    }

    const bin = path.join(
      path.dirname(hostPkgJson),
      "bin",
      process.platform === "win32" ? "sops.exe" : "sops"
    );
    const version = smokeTest(bin);
    expect(version).toContain(loadSopsManifest().sopsVersion);
  });
});
