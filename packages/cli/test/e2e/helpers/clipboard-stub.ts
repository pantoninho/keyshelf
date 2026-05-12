import { chmod, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface ClipboardStub {
  binDir: string;
  clipboardFile: string;
  env: NodeJS.ProcessEnv;
  read(): Promise<string>;
}

export async function setupClipboardStub(root: string): Promise<ClipboardStub> {
  const binDir = join(root, "clip-stubs");
  const clipboardFile = join(root, "clipboard.txt");
  await mkdir(binDir, { recursive: true });

  const tools =
    process.platform === "darwin"
      ? { write: "pbcopy", read: "pbpaste" }
      : { write: "wl-copy", read: "wl-paste" };

  await writeStub(join(binDir, tools.write), `cat > "$CLIPBOARD_FILE"`);
  await writeStub(join(binDir, tools.read), `cat "$CLIPBOARD_FILE" 2>/dev/null || true`);

  return {
    binDir,
    clipboardFile,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      CLIPBOARD_FILE: clipboardFile
    },
    async read() {
      if (!existsSync(clipboardFile)) return "";
      return await readFile(clipboardFile, "utf-8");
    }
  };
}

async function writeStub(path: string, body: string): Promise<void> {
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
}
