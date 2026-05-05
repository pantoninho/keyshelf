import type {
  AgeProviderOptions,
  AwsProviderOptions,
  BuiltinProviderRef,
  ConfigRecordInput,
  DefineConfigInput,
  GcpProviderOptions,
  KeyPaths,
  KeyshelfConfig,
  KeyTree,
  ProviderRef,
  SecretRecordInput,
  SopsProviderOptions
} from "./types.js";

export function defineConfig<
  const EnvNames extends readonly [string, ...string[]],
  const GroupNames extends readonly string[] = readonly [],
  const Keys extends KeyTree<EnvNames[number], GroupNames[number]> = KeyTree<
    EnvNames[number],
    GroupNames[number]
  >
>(
  input: DefineConfigInput<EnvNames, GroupNames, Keys>
): KeyshelfConfig<EnvNames[number], GroupNames[number], KeyPaths<Keys>> {
  return { __kind: "keyshelf:config", ...input };
}

export function config<const Input extends ConfigRecordInput>(
  input: Input
): Input & { __kind: "config" } {
  return { __kind: "config", ...input };
}

export function secret<const Input extends SecretRecordInput>(
  input: Input
): Input & { __kind: "secret" } {
  return { __kind: "secret", ...input };
}

export function age<const Options extends AgeProviderOptions>(
  options: Options
): ProviderRef<"age", Options> {
  return { __kind: "provider:age", name: "age", options };
}

export function aws<const Options extends AwsProviderOptions = AwsProviderOptions>(
  options: Options = {} as Options
): ProviderRef<"aws", Options> {
  return { __kind: "provider:aws", name: "aws", options };
}

export function gcp<const Options extends GcpProviderOptions>(
  options: Options
): ProviderRef<"gcp", Options> {
  return { __kind: "provider:gcp", name: "gcp", options };
}

export function sops<const Options extends SopsProviderOptions>(
  options: Options
): ProviderRef<"sops", Options> {
  return { __kind: "provider:sops", name: "sops", options };
}

export type { BuiltinProviderRef };
