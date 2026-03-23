import { defineCommand } from "citty";
import { readSchema } from "@/schema";
import { isTaggedValue } from "@/types";

/** Sort environments: "default" first, then alphabetical */
function sortEnvs(envs: string[]): string[] {
  return envs.sort((a, b) => {
    if (a === "default") return -1;
    if (b === "default") return 1;
    return a.localeCompare(b);
  });
}

export const lsCommand = defineCommand({
  meta: { description: "List all keys and their environments" },
  async run() {
    const schema = await readSchema();
    const entries = Object.entries(schema.keys);

    if (entries.length === 0) {
      process.stdout.write("No keys found.\n");
      return;
    }

    const rows = entries.map(([keyPath, entry]) => {
      const envs = sortEnvs(Object.keys(entry));
      const envLabels = envs.map((env) => {
        const value = entry[env];
        const provider = isTaggedValue(value) ? value._tag : "plain";
        return `${env} (${provider})`;
      });
      return { key: keyPath, envs: envLabels.join(", ") };
    });

    const maxKeyLen = Math.max(...rows.map((r) => r.key.length), 3);
    const header = `${"KEY".padEnd(maxKeyLen)}  ENVIRONMENTS`;
    const separator = `${"─".repeat(maxKeyLen)}  ${"─".repeat(40)}`;
    const lines = rows.map((r) => `${r.key.padEnd(maxKeyLen)}  ${r.envs}`);

    process.stdout.write([header, separator, ...lines, ""].join("\n"));
  }
});
