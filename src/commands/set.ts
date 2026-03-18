import { defineCommand } from "citty";
import { createInterface } from "node:readline";
import { readSchema, writeSchema, findSchemaPath } from "@/schema";
import { PROVIDERS } from "@/resolver";
import type { ProviderContext, TaggedValue } from "@/types";

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    return new Promise((resolve) => {
      rl.question("Enter value: ", (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8").trimEnd();
}

export const setCommand = defineCommand({
  meta: { description: "Store a value (optionally encrypted)" },
  args: {
    key: {
      type: "positional",
      description: "Key path (e.g. database/url)",
      required: true
    },
    value: {
      type: "positional",
      description: "Value to store (reads from stdin if omitted)",
      required: false
    },
    env: {
      type: "string",
      description: "Target environment",
      default: "default"
    },
    provider: {
      type: "string",
      description: "Provider (e.g. age, awssm)"
    }
  },
  async run({ args }) {
    const value = (args.value ?? (await readStdin())).trimEnd();
    const filePath = findSchemaPath();
    const schema = await readSchema(filePath);

    let entryValue: string | TaggedValue = value;

    if (args.provider) {
      const tag = `!${args.provider}`;
      const provider = PROVIDERS[tag];
      if (!provider?.set) {
        const supported = Object.keys(PROVIDERS)
          .map((t) => t.slice(1))
          .join(", ");
        throw new Error(`Unknown provider '${args.provider}'. Supported: ${supported}.`);
      }

      const context: ProviderContext = {
        projectName: schema.project,
        publicKey: schema.publicKey,
        keyPath: args.key,
        env: args.env
      };

      const ref = await provider.set(value, context);
      entryValue = { _tag: tag, value: ref };
    }

    if (!schema.keys[args.key]) {
      schema.keys[args.key] = {};
    }
    schema.keys[args.key][args.env] = entryValue;

    await writeSchema(schema, filePath);
    console.log(`Set '${args.key}' for env '${args.env}'.`);
  }
});
