import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { Decrypter } from "age-encryption";
import { writeAgeFixture } from "./helpers/age.js";
import { writeSopsFixture } from "./helpers/sops.js";

const CLI = join(import.meta.dirname, "..", "..", "bin", "keyshelf.ts");
const TSX = join(import.meta.dirname, "..", "..", "node_modules", ".bin", "tsx");

describe("keyshelf import (age)", () => {
  let root: string;
  let identityFile: string;
  let secretsDir: string;
  const envName = "age-test";

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "keyshelf-e2e-age-import-"));
    await writeAgeFixture(root, envName);
    identityFile = join(root, "key.txt");
    secretsDir = join(root, ".keyshelf", "secrets");
  });

  async function decryptFile(filePath: string): Promise<string> {
    const identity = await readFile(identityFile, "utf-8");
    const ciphertext = await readFile(filePath);
    const decrypter = new Decrypter();
    decrypter.addIdentity(identity.trim());
    return await decrypter.decrypt(ciphertext, "text");
  }

  it("uses default provider for secret keys when --provider is omitted", async () => {
    const dotenvPath = join(root, ".env");
    await writeFile(dotenvPath, "DB_HOST=imported-host\nDB_PASSWORD=imported-secret\n");

    execFileSync(TSX, [CLI, "import", "--env", envName, "--file", dotenvPath], {
      cwd: root,
      encoding: "utf-8"
    });

    // Secret should be encrypted via age (default provider)
    const plaintext = await decryptFile(join(secretsDir, "db_password.age"));
    expect(plaintext).toBe("imported-secret");

    // Config should be stored as plaintext in env yaml
    const envContent = await readFile(join(root, ".keyshelf", `${envName}.yaml`), "utf-8");
    expect(envContent).toContain("imported-host");
  });

  it("stores secrets via explicit --provider", async () => {
    const dotenvPath = join(root, ".env");
    await writeFile(dotenvPath, "DB_PASSWORD=explicit-provider-secret\n");

    execFileSync(
      TSX,
      [CLI, "import", "--env", envName, "--file", dotenvPath, "--provider", "age"],
      {
        cwd: root,
        encoding: "utf-8"
      }
    );

    const plaintext = await decryptFile(join(secretsDir, "db_password.age"));
    expect(plaintext).toBe("explicit-provider-secret");
  });
});

describe("keyshelf import (sops)", () => {
  let root: string;
  const envName = "sops-test";

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "keyshelf-e2e-sops-import-"));
    await writeSopsFixture(root, envName);
  });

  it("uses default provider for secret keys when --provider is omitted", async () => {
    const dotenvPath = join(root, ".env");
    await writeFile(dotenvPath, "DB_HOST=imported-host\nDB_PASSWORD=imported-secret\n");

    execFileSync(TSX, [CLI, "import", "--env", envName, "--file", dotenvPath], {
      cwd: root,
      encoding: "utf-8"
    });

    // Secret should be encrypted via sops (default provider) — verify via run
    const result = execFileSync(
      TSX,
      [CLI, "run", "--env", envName, "--", "node", "-e", "console.log(process.env.DB_PASSWORD)"],
      { cwd: root, encoding: "utf-8" }
    );
    expect(result.trim()).toBe("imported-secret");

    // Config should be stored as plaintext in env yaml
    const envContent = await readFile(join(root, ".keyshelf", `${envName}.yaml`), "utf-8");
    expect(envContent).toContain("imported-host");
  });

  it("stores secrets via explicit --provider", async () => {
    const dotenvPath = join(root, ".env");
    await writeFile(dotenvPath, "DB_PASSWORD=explicit-sops-secret\n");

    execFileSync(
      TSX,
      [CLI, "import", "--env", envName, "--file", dotenvPath, "--provider", "sops"],
      { cwd: root, encoding: "utf-8" }
    );

    const result = execFileSync(
      TSX,
      [CLI, "run", "--env", envName, "--", "node", "-e", "console.log(process.env.DB_PASSWORD)"],
      { cwd: root, encoding: "utf-8" }
    );
    expect(result.trim()).toBe("explicit-sops-secret");
  });
});
