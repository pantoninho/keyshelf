import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { generateIdentity } from "../../../src/providers/age.js";

export interface AgeFixtureOptions {
  cacheTtl?: number;
}

export async function writeAgeFixture(root: string, envName: string, options?: AgeFixtureOptions) {
  const identityFile = join(root, "key.txt");
  const secretsDir = join(root, ".keyshelf", "secrets");

  const identity = await generateIdentity();
  await writeFile(identityFile, identity);

  await writeFile(
    join(root, "keyshelf.yaml"),
    ["keys:", "  db:", "    host: localhost", '    password: !secret ""'].join("\n")
  );

  const envLines = [
    ...(options?.cacheTtl ? ["cache:", `  ttl: ${options.cacheTtl}`] : []),
    "default-provider:",
    "  name: age",
    `  identityFile: ${identityFile}`,
    `  secretsDir: ${secretsDir}`,
    "keys:",
    "  db:",
    "    host: prod-db"
  ];

  await mkdir(join(root, ".keyshelf"), { recursive: true });
  await writeFile(join(root, ".keyshelf", `${envName}.yaml`), envLines.join("\n"));

  await writeFile(
    join(root, ".env.keyshelf"),
    ["DB_HOST=db/host", "DB_PASSWORD=db/password"].join("\n")
  );
}
