import { defineCommand } from "citty";
import { readSchema } from "@/schema";
import { resolveAllKeys, resolveMappedKeys } from "@/resolver";
import { readEnvKeyshelf } from "@/env-keyshelf";

function formatDotenv(record: Record<string, string>): string {
  return Object.entries(record)
    .map(([key, value]) => `${key}="${value}"`)
    .join("\n");
}

export const exportCommand = defineCommand({
  meta: { description: "Export resolved values to stdout" },
  args: {
    env: {
      type: "string",
      description: "Target environment",
      required: true
    },
    format: {
      type: "string",
      description: "Output format (dotenv or json)",
      default: "dotenv"
    }
  },
  async run({ args }) {
    const schema = await readSchema();
    const mapping = await readEnvKeyshelf();
    const resolved = mapping
      ? await resolveMappedKeys(schema, args.env, mapping)
      : await resolveAllKeys(schema, args.env);

    if (args.format === "json") {
      process.stdout.write(JSON.stringify(resolved, null, 2));
    } else if (args.format === "dotenv") {
      process.stdout.write(formatDotenv(resolved));
    } else {
      throw new Error(`Unknown format '${args.format}'. Use 'dotenv' or 'json'.`);
    }
  }
});
