import { isTaggedValue } from "@/types";
import { ageProvider } from "@/providers/age";
import { awsSmProvider } from "@/providers/aws-sm";
import { gcpSmProvider } from "@/providers/gcp-sm";
import type { EntryValue, KeyshelfSchema, Provider, ProviderContext } from "@/types";

export const PROVIDERS: Record<string, Provider> = {
  "!age": ageProvider,
  "!awssm": awsSmProvider,
  "!gcsm": gcpSmProvider
};

/** Convert a key path to an environment variable name */
export function keyToEnvVar(keyPath: string): string {
  return keyPath.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
}

/** Resolve a single value — plain strings pass through, tagged values dispatch to providers */
export async function resolveValue(
  value: EntryValue,
  context: ProviderContext,
  providers: Record<string, Provider> = PROVIDERS
): Promise<string> {
  if (!isTaggedValue(value)) return value;

  const provider = providers[value._tag];
  if (!provider) {
    throw new Error(`Unknown provider '${value._tag}' for key '${context.keyPath}'.`);
  }
  return provider.get(value.value, context);
}

/** Resolve only keys referenced in a `.env.keyshelf` mapping, using custom env var names */
export async function resolveMappedKeys(
  schema: KeyshelfSchema,
  env: string,
  mapping: Record<string, string>
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  const entries = Object.entries(mapping).map(async ([envVarName, keyPath]) => {
    const entry = schema.keys[keyPath];
    if (!entry) {
      throw new Error(`Key '${keyPath}' referenced in .env.keyshelf not found in keyshelf.yaml`);
    }

    const value = entry[env] ?? entry.default;
    if (value === undefined) {
      throw new Error(`Key '${keyPath}' has no value for env '${env}' and no default.`);
    }

    const context: ProviderContext = {
      projectName: schema.project,
      publicKey: schema.publicKey,
      keyPath,
      env
    };

    result[envVarName] = await resolveValue(value, context);
  });

  await Promise.all(entries);
  return result;
}

/** Resolve all keys for a given environment, returning env var name → plaintext */
export async function resolveAllKeys(
  schema: KeyshelfSchema,
  env: string
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const providers = PROVIDERS;

  const entries = Object.entries(schema.keys).map(async ([keyPath, entry]) => {
    const value = entry[env] ?? entry.default;
    if (value === undefined) {
      throw new Error(`Key '${keyPath}' has no value for env '${env}' and no default.`);
    }

    const context: ProviderContext = {
      projectName: schema.project,
      publicKey: schema.publicKey,
      keyPath,
      env
    };

    const resolved = await resolveValue(value, context, providers);
    result[keyToEnvVar(keyPath)] = resolved;
  });

  await Promise.all(entries);
  return result;
}
