import { defineCommand } from "citty";
import { readSchema } from "@/schema";
import { resolveValue } from "@/resolver";
import type { ProviderContext } from "@/types";

export const getCommand = defineCommand({
  meta: { description: "Decrypt and print a single value" },
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
    }
  },
  async run({ args }) {
    const schema = await readSchema();
    const entry = schema.keys[args.key];
    if (!entry) {
      throw new Error(`Key '${args.key}' not found in keyshelf.yaml.`);
    }

    const value = entry[args.env] ?? entry.default;
    if (value === undefined) {
      throw new Error(`Key '${args.key}' has no value for env '${args.env}' and no default.`);
    }

    const context: ProviderContext = {
      projectName: schema.project,
      publicKey: schema.publicKey,
      keyPath: args.key,
      env: args.env
    };

    const resolved = await resolveValue(value, context);
    process.stdout.write(resolved);
  }
});
