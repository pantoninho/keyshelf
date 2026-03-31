import { readFile, writeFile, mkdir, stat, rm, link } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { Encrypter, Decrypter, generateIdentity, identityToRecipient } from "age-encryption";

export interface SecretCacheOptions {
  /** Directory to store encrypted cache files */
  cacheDir: string;
  /** Time-to-live in seconds */
  ttl: number;
}

function keyPathToFileName(keyPath: string): string {
  return keyPath.replace(/\//g, "_");
}

function cacheFilePath(cacheDir: string, envName: string, keyPath: string): string {
  return join(cacheDir, envName, `${keyPathToFileName(keyPath)}.age`);
}

function identityFilePath(cacheDir: string): string {
  return join(cacheDir, "identity.txt");
}

async function ensureIdentity(cacheDir: string): Promise<string> {
  const idPath = identityFilePath(cacheDir);

  try {
    const content = await readFile(idPath, "utf-8");
    return content.trim();
  } catch {
    // File doesn't exist yet — generate and write atomically
  }

  await mkdir(dirname(idPath), { recursive: true });

  const identity = await generateIdentity();
  const tmpPath = idPath + "." + randomBytes(6).toString("hex");
  await writeFile(tmpPath, identity + "\n", { mode: 0o600 });

  try {
    // link fails with EEXIST if another process created the file first
    await link(tmpPath, idPath);
  } catch {
    // Another process won — use their identity
    await rm(tmpPath, { force: true });
    const content = await readFile(idPath, "utf-8");
    return content.trim();
  }

  await rm(tmpPath, { force: true });
  return identity;
}

export class SecretCache {
  private identity: string | undefined;

  constructor(private readonly options: SecretCacheOptions) {}

  async get(envName: string, keyPath: string): Promise<string | undefined> {
    const filePath = cacheFilePath(this.options.cacheDir, envName, keyPath);

    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch {
      return undefined;
    }

    const ageSeconds = (Date.now() - fileStat.mtimeMs) / 1000;
    if (ageSeconds > this.options.ttl) {
      await rm(filePath, { force: true });
      return undefined;
    }

    try {
      const identity = await this.getIdentity();
      const ciphertext = await readFile(filePath);
      const decrypter = new Decrypter();
      decrypter.addIdentity(identity);
      return await decrypter.decrypt(ciphertext, "text");
    } catch {
      // Corrupt or unreadable cache entry — treat as miss
      await rm(filePath, { force: true });
      return undefined;
    }
  }

  async set(envName: string, keyPath: string, value: string): Promise<void> {
    const identity = await this.getIdentity();
    const recipient = await identityToRecipient(identity);

    const encrypter = new Encrypter();
    encrypter.addRecipient(recipient);
    const ciphertext = await encrypter.encrypt(value);

    const filePath = cacheFilePath(this.options.cacheDir, envName, keyPath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, ciphertext);
  }

  private async getIdentity(): Promise<string> {
    if (!this.identity) {
      this.identity = await ensureIdentity(this.options.cacheDir);
    }
    return this.identity;
  }
}
