import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Encrypter, Decrypter, generateIdentity, identityToRecipient } from "age-encryption";
import type { Provider, ProviderContext } from "./types.js";
import {
  readIdentity,
  readIdentityWithRecipient,
  requireStringConfig,
  resolvePath
} from "./_paths.js";

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

export class AgeProvider implements Provider {
  name = "age";

  private resolveOptions(ctx: ProviderContext): AgeProviderOptions {
    return {
      identityFile: resolvePath(requireStringConfig("age", ctx, "identityFile"), ctx.rootDir),
      secretsDir: resolvePath(requireStringConfig("age", ctx, "secretsDir"), ctx.rootDir)
    };
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
    const { recipient } = await readIdentityWithRecipient(opts.identityFile);

    const encrypter = new Encrypter();
    encrypter.addRecipient(recipient);
    const ciphertext = await encrypter.encrypt(value);

    const filePath = secretFilePath(opts.secretsDir, ctx.keyPath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, ciphertext);
  }
}

export { generateIdentity, identityToRecipient };
