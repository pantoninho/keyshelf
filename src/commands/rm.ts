import { defineCommand } from "citty";
import { createInterface } from "node:readline";
import { findSchemaPath, readSchema, writeSchema } from "@/schema";
import { buildProviders } from "@/resolver";
import { isTaggedValue } from "@/types";
import type { ProviderContext } from "@/types";

async function confirmRemoval(key: string, env: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(`Remove '${key}' for env '${env}'? (y/N) `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

export const rmCommand = defineCommand({
  meta: { description: "Remove a value for a specific environment" },
  args: {
    key: {
      type: "positional",
      description: "Key path (e.g. database/url)",
      required: true
    },
    env: {
      type: "string",
      description: "Target environment",
      default: "default"
    },
    yes: {
      type: "boolean",
      alias: "y",
      description: "Skip confirmation prompt",
      default: false
    }
  },
  async run({ args }) {
    const filePath = findSchemaPath();
    const schema = await readSchema(filePath);

    if (!schema.keys[args.key]) {
      throw new Error(`Key '${args.key}' not found in keyshelf.yaml.`);
    }

    const value = schema.keys[args.key][args.env];
    if (value === undefined) {
      throw new Error(`Key '${args.key}' has no value for env '${args.env}'.`);
    }

    if (!args.yes) {
      const confirmed = await confirmRemoval(args.key, args.env);
      if (!confirmed) {
        process.stderr.write("Aborted.\n");
        return;
      }
    }

    if (isTaggedValue(value)) {
      const providers = buildProviders(schema);
      const provider = providers[value._tag];

      if (provider?.remove) {
        const context: ProviderContext = {
          projectName: schema.project,
          publicKey: schema.publicKey,
          keyPath: args.key,
          env: args.env
        };
        await provider.remove(value.value, context);
      }
    }

    delete schema.keys[args.key][args.env];

    if (Object.keys(schema.keys[args.key]).length === 0) {
      delete schema.keys[args.key];
    }

    await writeSchema(schema, filePath);
    console.log(`Removed '${args.key}' for env '${args.env}'.`);
  }
});
