export type ConfigScalar = string | number | boolean;
export type ConfigBinding = ConfigScalar;

export interface ProviderRef<Name extends string = string, Options = unknown> {
  __kind: `provider:${Name}`;
  name: Name;
  options: Options;
}

export interface AgeProviderOptions {
  identityFile?: string;
  recipient?: string;
}

export interface GcpProviderOptions {
  project: string;
  secret?: string;
  version?: string;
}

export interface SopsProviderOptions {
  file: string;
  path?: string;
}

export type BuiltinProviderRef =
  | ProviderRef<"age", AgeProviderOptions>
  | ProviderRef<"gcp", GcpProviderOptions>
  | ProviderRef<"sops", SopsProviderOptions>;

export interface BaseRecord<GroupName extends string = string> {
  group?: GroupName;
  optional?: boolean;
  description?: string;
}

export interface ConfigRecordInput<EnvName extends string = string, GroupName extends string = string>
  extends BaseRecord<GroupName> {
  value?: ConfigBinding;
  default?: ConfigBinding;
  values?: Partial<Record<EnvName, ConfigBinding>>;
}

export interface SecretRecordInput<EnvName extends string = string, GroupName extends string = string>
  extends BaseRecord<GroupName> {
  value?: BuiltinProviderRef;
  default?: BuiltinProviderRef;
  values?: Partial<Record<EnvName, BuiltinProviderRef>>;
}

export type ConfigRecord<
  EnvName extends string = string,
  GroupName extends string = string
> = ConfigRecordInput<EnvName, GroupName> & {
  __kind: "config";
};

export type SecretRecord<
  EnvName extends string = string,
  GroupName extends string = string
> = SecretRecordInput<EnvName, GroupName> & {
  __kind: "secret";
};

export type KeyLeaf<EnvName extends string = string, GroupName extends string = string> =
  | ConfigScalar
  | ConfigRecord<EnvName, GroupName>
  | SecretRecord<EnvName, GroupName>;

export type KeyTree<EnvName extends string = string, GroupName extends string = string> = {
  readonly [key: string]: KeyLeaf<EnvName, GroupName> | KeyTree<EnvName, GroupName>;
};

export interface DefineConfigInput<
  EnvNames extends readonly [string, ...string[]] = readonly [string, ...string[]],
  GroupNames extends readonly string[] = readonly string[],
  Keys extends KeyTree<EnvNames[number], GroupNames[number]> = KeyTree<
    EnvNames[number],
    GroupNames[number]
  >
> {
  envs: EnvNames;
  groups?: GroupNames;
  keys: Keys;
}

type JoinPath<Prefix extends string, Key extends string> = Prefix extends ""
  ? Key
  : `${Prefix}/${Key}`;

type SplitPath<Path extends string> = Path extends `${infer Head}/${infer Rest}`
  ? Head extends ""
    ? never
    : Rest extends ""
      ? never
      : Path
  : Path;

export type KeyPaths<Tree, Prefix extends string = ""> = Tree extends ConfigRecord | SecretRecord
  ? Prefix
  : Tree extends ConfigScalar
    ? Prefix
    : Tree extends object
      ? {
          [Key in keyof Tree & string]: Tree[Key] extends ConfigRecord | SecretRecord | ConfigScalar
            ? JoinPath<Prefix, SplitPath<Key>>
            : Tree[Key] extends object
              ? KeyPaths<Tree[Key], JoinPath<Prefix, SplitPath<Key>>>
              : never;
        }[keyof Tree & string]
      : never;

export interface KeyshelfConfig<
  EnvName extends string = string,
  GroupName extends string = string,
  Path extends string = string
> {
  __kind: "keyshelf:config";
  envs: readonly EnvName[];
  groups?: readonly GroupName[];
  keys: KeyTree<EnvName, GroupName>;
  __paths?: Path;
}

export type NormalizedRecord =
  | {
      path: string;
      kind: "config";
      group?: string;
      optional: boolean;
      description?: string;
      value?: ConfigBinding;
      default?: ConfigBinding;
      values?: Record<string, ConfigBinding>;
    }
  | {
      path: string;
      kind: "secret";
      group?: string;
      optional: boolean;
      description?: string;
      value?: BuiltinProviderRef;
      default?: BuiltinProviderRef;
      values?: Record<string, BuiltinProviderRef>;
    };

export interface NormalizedConfig {
  envs: string[];
  groups: string[];
  keys: NormalizedRecord[];
}
