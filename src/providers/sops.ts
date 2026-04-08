import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes, createCipheriv, createDecipheriv, createHmac } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Encrypter, Decrypter, identityToRecipient } from "age-encryption";
import type { Provider, ProviderContext } from "./types.js";

export interface SopsProviderOptions {
  identityFile: string;
  secretsFile: string;
}

interface EncryptedEntry {
  data: string;
  iv: string;
  tag: string;
}

interface SecretsFile {
  entries: Record<string, EncryptedEntry>;
  sops: {
    dataKey: string;
    mac: string;
  };
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

function generateDataKey(): Buffer {
  return randomBytes(32);
}

async function encryptDataKey(dataKey: Buffer, recipient: string): Promise<string> {
  const encrypter = new Encrypter();
  encrypter.addRecipient(recipient);
  const ciphertext = await encrypter.encrypt(dataKey);
  // encrypt(Buffer) returns Uint8Array — encode as base64 for JSON storage
  if (typeof ciphertext === "string") return ciphertext;
  return Buffer.from(ciphertext).toString("base64");
}

async function decryptDataKey(encrypted: string, identity: string): Promise<Buffer> {
  const decrypter = new Decrypter();
  decrypter.addIdentity(identity);
  const ciphertext = Buffer.from(encrypted, "base64");
  const plain = await decrypter.decrypt(ciphertext, "uint8array");
  return Buffer.from(plain);
}

function encryptValue(dataKey: Buffer, plaintext: string): EncryptedEntry {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dataKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    data: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64")
  };
}

function decryptValue(dataKey: Buffer, entry: EncryptedEntry): string {
  const decipher = createDecipheriv("aes-256-gcm", dataKey, Buffer.from(entry.iv, "base64"));
  decipher.setAuthTag(Buffer.from(entry.tag, "base64"));
  return decipher.update(entry.data, "base64", "utf8") + decipher.final("utf8");
}

function computeMac(dataKey: Buffer, entries: Record<string, EncryptedEntry>): string {
  const hmac = createHmac("sha256", dataKey);
  for (const key of Object.keys(entries).sort()) {
    const entry = entries[key];
    hmac.update(key);
    hmac.update(entry.data);
    hmac.update(entry.iv);
    hmac.update(entry.tag);
  }
  return hmac.digest("base64");
}

function verifyMac(dataKey: Buffer, file: SecretsFile): void {
  const expected = computeMac(dataKey, file.entries);
  if (expected !== file.sops.mac) {
    throw new Error("sops: MAC verification failed — secrets file may have been tampered with");
  }
}

async function readSecretsFile(path: string): Promise<SecretsFile> {
  const content = await readFile(path, "utf-8");
  return JSON.parse(content) as SecretsFile;
}

async function writeSecretsFile(path: string, file: SecretsFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(file, null, 2) + "\n");
}

export class SopsProvider implements Provider {
  name = "sops";

  private resolveOptions(ctx: ProviderContext): SopsProviderOptions {
    const identityFile = ctx.config.identityFile;
    const secretsFile = ctx.config.secretsFile;

    if (typeof identityFile !== "string") {
      throw new Error(`sops provider requires "identityFile" config for "${ctx.keyPath}"`);
    }
    if (typeof secretsFile !== "string") {
      throw new Error(`sops provider requires "secretsFile" config for "${ctx.keyPath}"`);
    }

    return {
      identityFile: expandTilde(identityFile),
      secretsFile: expandTilde(secretsFile)
    };
  }

  async resolve(ctx: ProviderContext): Promise<string> {
    const opts = this.resolveOptions(ctx);
    const file = await readSecretsFile(opts.secretsFile);
    const identity = await readIdentity(opts.identityFile);
    const dataKey = await decryptDataKey(file.sops.dataKey, identity);

    verifyMac(dataKey, file);

    const entry = file.entries[ctx.keyPath];
    if (!entry) {
      throw new Error(`sops: secret "${ctx.keyPath}" not found in ${opts.secretsFile}`);
    }

    return decryptValue(dataKey, entry);
  }

  async validate(ctx: ProviderContext): Promise<boolean> {
    try {
      const opts = this.resolveOptions(ctx);
      const file = await readSecretsFile(opts.secretsFile);
      return ctx.keyPath in file.entries;
    } catch {
      return false;
    }
  }

  async set(ctx: ProviderContext, value: string): Promise<void> {
    const opts = this.resolveOptions(ctx);
    const identity = await readIdentity(opts.identityFile);
    const recipient = await identityToRecipient(identity);

    let file: SecretsFile;
    let dataKey: Buffer;

    try {
      file = await readSecretsFile(opts.secretsFile);
      dataKey = await decryptDataKey(file.sops.dataKey, identity);
      verifyMac(dataKey, file);
    } catch (err) {
      const isNewFile =
        err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT";
      if (!isNewFile) throw err;

      dataKey = generateDataKey();
      file = {
        entries: {},
        sops: {
          dataKey: await encryptDataKey(dataKey, recipient),
          mac: ""
        }
      };
    }

    file.entries[ctx.keyPath] = encryptValue(dataKey, value);
    file.sops.mac = computeMac(dataKey, file.entries);

    await writeSecretsFile(opts.secretsFile, file);
  }
}
