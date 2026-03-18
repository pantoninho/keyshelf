import { mkdir, writeFile, readFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { Encrypter, Decrypter, generateIdentity, identityToRecipient, armor } from "age-encryption";
import type { Provider, ProviderContext } from "@/types";

/** Path to the private key file for a project */
export function getKeyPath(projectName: string): string {
  return join(homedir(), ".config", "keyshelf", projectName, "key");
}

/** Generate an age keypair, store private key on disk, return public key */
export async function generateKeyPair(projectName: string): Promise<string> {
  const identity = await generateIdentity();
  const recipient = identityToRecipient(identity);

  const keyPath = getKeyPath(projectName);
  await mkdir(join(keyPath, ".."), { recursive: true });
  await writeFile(keyPath, identity, "utf-8");
  await chmod(keyPath, 0o600);

  return recipient;
}

/** Load the private key (identity) from disk */
export async function loadPrivateKey(projectName: string): Promise<string> {
  const keyPath = getKeyPath(projectName);
  try {
    return (await readFile(keyPath, "utf-8")).trim();
  } catch {
    throw new Error(`Private key not found at ${keyPath}. Run 'keyshelf init' to generate one.`);
  }
}

/** age encryption/decryption provider */
export const ageProvider: Provider = {
  async get(reference: string, context: ProviderContext): Promise<string> {
    const identity = await loadPrivateKey(context.projectName);
    const ciphertext = armor.decode(reference);

    const d = new Decrypter();
    d.addIdentity(identity);
    return d.decrypt(ciphertext, "text");
  },

  async set(value: string, context: ProviderContext): Promise<string> {
    if (!context.publicKey) {
      throw new Error("No publicKey in keyshelf.yaml. Run 'keyshelf init' to generate one.");
    }

    const e = new Encrypter();
    e.addRecipient(context.publicKey);
    const ciphertext = await e.encrypt(value);
    return armor.encode(ciphertext);
  }
};
