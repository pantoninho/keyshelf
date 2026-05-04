import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateIdentity } from "../../../src/providers/age.js";

export interface AgeFixturePaths {
  identityFile: string;
  secretsDir: string;
}

export async function setupAgeFixtureDir(root: string): Promise<AgeFixturePaths> {
  const identityFile = join(root, "key.txt");
  const secretsDir = join(root, ".keyshelf", "secrets");
  await writeFile(identityFile, await generateIdentity());
  await mkdir(secretsDir, { recursive: true });
  return { identityFile, secretsDir };
}

export async function writeKeyshelfConfig(root: string, body: string[]): Promise<void> {
  await writeFile(
    join(root, "keyshelf.config.ts"),
    [
      `import { defineConfig, config, secret, age } from "keyshelf/config";`,
      ``,
      `export default defineConfig({`,
      ...body.map((line) => `  ${line}`),
      `});`,
      ``
    ].join("\n")
  );
}

export async function writeEnvKeyshelf(root: string, mappings: string[]): Promise<void> {
  await writeFile(join(root, ".env.keyshelf"), mappings.join("\n"));
}
