import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Readable, Writable } from "node:stream";
import { handleV4ConfigDetected } from "../../src/cli/v4-prompt.js";
import { V4ConfigDetectedError } from "../../src/config/index.js";

class CollectingWritable extends Writable {
  chunks: string[] = [];

  override _write(
    chunk: Buffer | string,
    _encoding: string,
    callback: (err?: Error | null) => void
  ): void {
    this.chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf-8"));
    callback();
  }

  text(): string {
    return this.chunks.join("");
  }
}

function nonTtyStdin(): Readable & { isTTY?: boolean } {
  const stream = Readable.from([]) as Readable & { isTTY?: boolean };
  stream.isTTY = false;
  return stream;
}

describe("handleV4ConfigDetected (non-TTY)", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number): never => {
      throw new Error(`__exit:${code ?? 0}`);
    }) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it("writes a non-interactive instruction and exits with code 1", async () => {
    const errorOutput = new CollectingWritable();
    const output = new CollectingWritable();
    const err = new V4ConfigDetectedError("/tmp/legacy");

    await expect(
      handleV4ConfigDetected(err, {
        input: nonTtyStdin(),
        output,
        errorOutput
      })
    ).rejects.toThrow("__exit:1");

    const text = errorOutput.text();
    expect(text).toContain("/tmp/legacy/keyshelf.yaml");
    expect(text).toContain("npx @keyshelf/migrate");
    expect(text).toContain("/tmp/legacy");
  });
});
