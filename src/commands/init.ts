import { defineCommand } from "citty";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { generateKeyPair, getKeyPath } from "@/providers/age";
import { writeSchema } from "@/schema";
import type { KeyshelfSchema } from "@/types";

export const initCommand = defineCommand({
  meta: { description: "Initialize a new keyshelf project" },
  args: {
    project: {
      type: "positional",
      description: "Project name",
      required: true,
    },
  },
  async run({ args }) {
    const filePath = resolve("keyshelf.yaml");
    if (existsSync(filePath)) {
      throw new Error("keyshelf.yaml already exists in this directory.");
    }

    const publicKey = await generateKeyPair(args.project);

    const schema: KeyshelfSchema = {
      project: args.project,
      publicKey,
      keys: {},
    };
    await writeSchema(schema, filePath);

    console.log(`Initialized project '${args.project}'.`);
    console.log(`Public key:  ${publicKey}`);
    console.log(`Private key: ${getKeyPath(args.project)}`);
  },
});
