import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Encrypter, Decrypter, generateIdentity, identityToRecipient } from "age-encryption";
import type { Provider, ProviderContext } from "./types.js";

export interface AgeProviderOptions {
  identityFile: string;
  secretsDir: string;
}

function keyPathToFileName(keyPath: string): string {
  return keyPath.replace(/\//g, "_");
}

function secretFilePath(secretsDir: string, keyPath: string): string {
  return join(secretsDir, `${keyPathToFileName(keyPath)}.age`);
}

function expandTilde(filePath: string): string {
  if (filePath.startsWith("~/") || filePath === "~") {
    return join(homedir(), filePath.slice(1));
  }
  return filePath;
}

async function readIdentity(identityFile: string): Promise<string> {
  const content = await readFile(identityFile, "utf-8");
  return content.trim();
}

export class AgeProvider implements Provider {
  name = "age";

  private resolveOptions(ctx: ProviderContext): AgeProviderOptions {
    const identityFile = ctx.config.identityFile;
    const secretsDir = ctx.config.secretsDir;

    if (typeof identityFile !== "string") {
      throw new Error(`age provider requires "identityFile" config for "${ctx.keyPath}"`);
    }
    if (typeof secretsDir !== "string") {
      throw new Error(`age provider requires "secretsDir" config for "${ctx.keyPath}"`);
    }

    return { identityFile: expandTilde(identityFile), secretsDir: expandTilde(secretsDir) };
  }

  async resolve(ctx: ProviderContext): Promise<string> {
    const opts = this.resolveOptions(ctx);
    const filePath = secretFilePath(opts.secretsDir, ctx.keyPath);
    const identity = await readIdentity(opts.identityFile);

    const ciphertext = await readFile(filePath);
    const decrypter = new Decrypter();
    decrypter.addIdentity(identity);
    return await decrypter.decrypt(ciphertext, "text");
  }

  async validate(ctx: ProviderContext): Promise<boolean> {
    try {
      const opts = this.resolveOptions(ctx);
      const filePath = secretFilePath(opts.secretsDir, ctx.keyPath);
      await readFile(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async set(ctx: ProviderContext, value: string): Promise<void> {
    const opts = this.resolveOptions(ctx);
    const identity = await readIdentity(opts.identityFile);
    const recipient = await identityToRecipient(identity);

    const encrypter = new Encrypter();
    encrypter.addRecipient(recipient);
    const ciphertext = await encrypter.encrypt(value);

    const filePath = secretFilePath(opts.secretsDir, ctx.keyPath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, ciphertext);
  }
}

export { generateIdentity, identityToRecipient };
