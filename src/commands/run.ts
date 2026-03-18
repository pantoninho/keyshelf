import { defineCommand } from "citty";
import { spawnSync } from "node:child_process";
import { readSchema } from "@/schema";
import { resolveAllKeys } from "@/resolver";

export const runCommand = defineCommand({
  meta: { description: "Inject resolved values as env vars and run a command" },
  args: {
    env: {
      type: "string",
      description: "Target environment",
      required: true,
    },
  },
  async run({ args }) {
    const idx = process.argv.indexOf("--");
    const cmd = idx >= 0 ? process.argv.slice(idx + 1) : [];
    if (cmd.length === 0) {
      throw new Error(
        "No command specified. Usage: keyshelf run --env <env> -- <command>"
      );
    }

    const schema = await readSchema();
    const resolved = await resolveAllKeys(schema, args.env);

    const result = spawnSync(cmd[0], cmd.slice(1), {
      env: { ...process.env, ...resolved },
      stdio: "inherit",
    });

    process.exit(result.status ?? 1);
  },
});
