/** A tagged value from YAML custom tags like !age */
export interface TaggedValue {
  _tag: string;
  value: string;
}

/** A value is either a plain string or a provider-tagged reference */
export type EntryValue = string | TaggedValue;

/** One key entry with environment overrides */
export interface KeyEntry {
  default?: EntryValue;
  [env: string]: EntryValue | undefined;
}

/** The full keyshelf.yaml structure */
export interface KeyshelfSchema {
  project: string;
  publicKey?: string;
  keys: Record<string, KeyEntry>;
}

/** Context passed to providers during get/set */
export interface ProviderContext {
  projectName: string;
  publicKey?: string;
  keyPath: string;
  env: string;
}

/** Provider interface — get is required, set/remove are optional */
export interface Provider {
  get(reference: string, context: ProviderContext): Promise<string>;
  set?(value: string, context: ProviderContext): Promise<string>;
  remove?(reference: string, context: ProviderContext): Promise<void>;
}

/** Type guard for TaggedValue */
export function isTaggedValue(value: unknown): value is TaggedValue {
  return (
    typeof value === "object" &&
    value !== null &&
    "_tag" in value &&
    typeof (value as TaggedValue)._tag === "string" &&
    "value" in value &&
    typeof (value as TaggedValue).value === "string"
  );
}
