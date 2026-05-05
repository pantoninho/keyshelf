import { readFile, writeFile, mkdir, readdir, copyFile, rm } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { dirname, join } from "node:path";
import { Encrypter, Decrypter, generateIdentity, identityToRecipient } from "age-encryption";
import type {
  Provider,
  ProviderContext,
  ProviderListContext,
  StorageScope,
  StoredKey
} from "./types.js";
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
  storageScope: StorageScope = "envless";

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

  async copy(from: ProviderContext, to: ProviderContext): Promise<void> {
    // Recipient is fixed in v5, so a byte-level copy is sufficient — no
    // need to decrypt and re-encrypt.
    const opts = this.resolveOptions(from);
    const fromPath = secretFilePath(opts.secretsDir, from.keyPath);
    const toPath = secretFilePath(opts.secretsDir, to.keyPath);
    await mkdir(dirname(toPath), { recursive: true });
    await copyFile(fromPath, toPath);
  }

  async delete(ctx: ProviderContext): Promise<void> {
    const opts = this.resolveOptions(ctx);
    const filePath = secretFilePath(opts.secretsDir, ctx.keyPath);
    await rm(filePath, { force: true });
  }

  async list(ctx: ProviderListContext): Promise<StoredKey[]> {
    const secretsDir = resolvePath(requireStringConfig("age", ctx, "secretsDir"), ctx.rootDir);

    let entries: Dirent[];
    try {
      entries = await readdir(secretsDir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }

    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".age"))
      .map((e) => {
        const stem = e.name.slice(0, -".age".length);
        // Reverse keyPathToFileName: '_' encodes '/'. Path segments containing
        // literal '_' are misparsed here — Phase 5 of the `up` plan tightens
        // schema validation to forbid '_' in segments.
        return { keyPath: stem.replace(/_/g, "/"), envName: undefined };
      });
  }
}

export { generateIdentity, identityToRecipient };
