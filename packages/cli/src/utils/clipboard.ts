import spawn from "cross-spawn";

interface ClipboardTool {
  command: string;
  args: string[];
}

interface ClipboardSupport {
  write: ClipboardTool;
  read: ClipboardTool;
}

export async function detectClipboard(): Promise<ClipboardSupport> {
  if (process.platform === "darwin") {
    return {
      write: { command: "pbcopy", args: [] },
      read: { command: "pbpaste", args: [] }
    };
  }

  if (process.platform === "win32") {
    return {
      write: { command: "clip", args: [] },
      read: {
        command: "powershell.exe",
        args: ["-NoProfile", "-Command", "Get-Clipboard"]
      }
    };
  }

  if (process.platform === "linux") {
    if (await hasCommand("wl-copy")) {
      return {
        write: { command: "wl-copy", args: [] },
        read: { command: "wl-paste", args: ["--no-newline"] }
      };
    }
    if (await hasCommand("xclip")) {
      return {
        write: { command: "xclip", args: ["-selection", "clipboard"] },
        read: { command: "xclip", args: ["-selection", "clipboard", "-o"] }
      };
    }
    if (await hasCommand("xsel")) {
      return {
        write: { command: "xsel", args: ["--clipboard", "--input"] },
        read: { command: "xsel", args: ["--clipboard", "--output"] }
      };
    }
    throw new Error(
      "no clipboard tool found. Install one of: wl-clipboard (Wayland), xclip, or xsel."
    );
  }

  throw new Error(`clipboard not supported on platform ${process.platform}`);
}

export async function writeClipboard(text: string): Promise<void> {
  const support = await detectClipboard();
  await runWithStdin(support.write, text);
}

export async function readClipboard(): Promise<string> {
  const support = await detectClipboard();
  return runCaptureStdout(support.read);
}

function runWithStdin(tool: ClipboardTool, input: string): Promise<void> {
  return runTool(tool, "ignore", (child) => child.stdin?.end(input)).then(() => undefined);
}

function runCaptureStdout(tool: ClipboardTool): Promise<string> {
  return runTool(tool, "pipe");
}

function runTool(
  tool: ClipboardTool,
  stdout: "pipe" | "ignore",
  onSpawn?: (child: ReturnType<typeof spawn>) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(tool.command, tool.args, {
      stdio: [stdout === "pipe" ? "ignore" : "pipe", stdout, "pipe"]
    });
    let out = "";
    let err = "";
    child.stdout?.on("data", (chunk) => (out += chunk.toString()));
    child.stderr?.on("data", (chunk) => (err += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(out);
        return;
      }
      reject(new Error(`${tool.command} exited with code ${code}${err ? `: ${err}` : ""}`));
    });
    onSpawn?.(child);
  });
}

function hasCommand(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}
