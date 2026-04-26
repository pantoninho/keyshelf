import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { generateIdentity } from "../../../src/providers/age.js";

export async function writeSopsFixture(root: string, envName: string) {
  const identityFile = join(root, "key.txt");
  const secretsFile = join(root, ".keyshelf", "secrets.json");

  const identity = await generateIdentity();
  await writeFile(identityFile, identity);

  await writeFile(
    join(root, "keyshelf.yaml"),
    ["keys:", "  db:", "    host: localhost", '    password: !secret ""'].join("\n")
  );

  await mkdir(join(root, ".keyshelf"), { recursive: true });
  await writeFile(
    join(root, ".keyshelf", `${envName}.yaml`),
    [
      "default-provider:",
      "  name: sops",
      `  identityFile: ${identityFile}`,
      `  secretsFile: ${secretsFile}`,
      "keys:",
      "  db:",
      "    host: prod-db"
    ].join("\n")
  );

  await writeFile(
    join(root, ".env.keyshelf"),
    ["DB_HOST=db/host", "DB_PASSWORD=db/password"].join("\n")
  );
}
