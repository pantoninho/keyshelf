# Feature: AWS Secrets Manager Provider

## Overview

Add a fourth secret provider, `aws`, backed by AWS Secrets Manager. It is the
AWS analogue of the existing `gcp` provider (GCP Secret Manager): a remote,
per-env secret store keyed off the keyshelf project name, the env name, and
the key path. Users in AWS-hosted monorepos should be able to write
`secret({ value: aws({ region: "eu-west-1" }) })` in `keyshelf.config.ts` (or
`!aws { region: eu-west-1 }` in YAML) and have `keyshelf run / set / up` work
end-to-end against AWS.

## Agreed Approach

- **Mirror `gcp`, don't reinvent.** The GCP provider already encodes the
  exact storage model we want for AWS: `keyshelf/<name?>/<env?>/<path>` ids,
  per-env scope, idempotent ensure/version/delete, listing via prefix filter,
  typed auth errors. The AWS provider is a port of that file, swapping the
  Google client for `@aws-sdk/client-secrets-manager`.
- **`storageScope: "perEnv"`.** Env is part of the secret id, like `gcp`. The
  reconcile planner already handles per-env fan-out via this field — no
  planner work needed.
- **Use `/` as the path separator in the secret name.** AWS Secrets Manager
  permits `/` in names (it's the conventional hierarchy character there) and
  the AWS console renders the slashes as folders. This is the one storage-id
  difference vs GCP, which had to mangle `/` to `__`. Keeping `/` natural
  means no path-segment restriction is needed (the existing
  "no underscore in path segments" rule from the keyshelf-up plan still
  applies for `age`, but does not constrain AWS).
- **No required options.** Region is resolved by the AWS SDK's default
  region chain (`AWS_REGION` → `AWS_DEFAULT_REGION` → active profile's
  `region` in `~/.aws/config`). Users who already have an AWS profile
  configured shouldn't have to repeat themselves in keyshelf config. If the
  SDK cannot resolve a region, the first call fails with the SDK's own
  region-missing error, which we wrap into a typed message pointing at
  `AWS_REGION` or `aws configure`. An explicit `region` in the binding is
  still supported and overrides the SDK chain — useful when one keyshelf
  config talks to multiple regions. `kmsKeyId` is optional too, passed
  straight through to `CreateSecret` for customer-managed KMS encryption.
  No account id (the SDK gets that from credentials).
- **Auth follows the AWS SDK default credential chain.** Env vars, shared
  credentials file, SSO, IAM role — all handled by the SDK. We wrap auth
  failures in a typed `AwsAuthError` with a "configure AWS credentials"
  message, parallel to `GcpAuthError`.
- **Listing uses `ListSecrets` with a name-prefix filter.** Filter by
  `keyshelf/<keyshelfName>/` (or just `keyshelf/` when no name) so we don't
  enumerate the whole account. Paginate with `NextToken`.
- **Tests are unit-only with a mocked client.** No live AWS calls in CI.
  Mirror the structure of `test/unit/providers/gcp-sm.test.ts` exactly so
  reviewers can diff the two side-by-side.

## Implementation Roadmap

Single PR is fine — the surface is small, the planner already supports
per-env providers, and there's no destructive migration. If the diff feels
unwieldy at review time, split Phase 3 (docs + examples) out.

### Phase 1: Provider implementation

#### Task 1.1: Add the AWS SDK dependency

- **Description**: Add `@aws-sdk/client-secrets-manager` to
  `packages/cli/package.json` dependencies. Pick the latest stable v3.x.
- **Files**: `packages/cli/package.json`, `package-lock.json`
- **Details**: Match the dependency-style of `@google-cloud/secret-manager`
  (caret range, runtime dep not devDep). The AWS SDK v3 is modular — only
  pull the secrets-manager client, not the umbrella `aws-sdk` package.

#### Task 1.2: Implement `AwsSmProvider`

- **Description**: New file `packages/cli/src/providers/aws-sm.ts` with an
  `AwsSmProvider` class implementing the full `Provider` interface
  (`resolve`, `validate`, `set`, `copy`, `delete`, `list`).
- **Files**: `packages/cli/src/providers/aws-sm.ts` (new)
- **Details**:
  - Class shape mirrors `GcpSmProvider` (`packages/cli/src/providers/gcp-sm.ts`).
    Constructor takes an optional `SecretsManagerClient` for injection in
    tests; otherwise the provider lazily constructs one per region key
    (the resolved region string, or `"__default__"` when ctx has none —
    the SDK does its own resolution from env/profile in that case).
  - Secret id helper:
    ```ts
    export function toSecretId(
      keyshelfName: string | undefined,
      envName: string | undefined,
      keyPath: string
    ): string {
      const segments = ["keyshelf"];
      if (keyshelfName !== undefined) segments.push(keyshelfName);
      if (envName !== undefined && envName !== "") segments.push(envName);
      segments.push(keyPath); // already `/`-separated
      return segments.join("/");
    }
    ```
    Treat `envName === ""` as envless, identical to `gcp-sm.ts`.
  - `resolve` → `GetSecretValueCommand`. Read `SecretString` (string), or
    decode `SecretBinary` (Uint8Array) as UTF-8 if string is empty. Throw
    "has no payload" parallel to gcp.
  - `validate` → `DescribeSecretCommand`. True on success, false on
    `ResourceNotFoundException`, throw `AwsAuthError` on auth errors.
  - `set` → `CreateSecretCommand` first; on `ResourceExistsException`, fall
    back to `PutSecretValueCommand` (AWS doesn't have a single
    upsert call). Pass `KmsKeyId` to `CreateSecretCommand` when configured.
    Idempotent: matches gcp's `ensureSecret` + `addVersion` split.
  - `delete` → `DeleteSecretCommand` with `ForceDeleteWithoutRecovery: true`
    so reconcile is genuinely removing storage (the default 30-day recovery
    window would leave orphans visible in `list`). Treat
    `ResourceNotFoundException` as success (idempotent).
  - `copy(from, to)` → read source via `GetSecretValueCommand`, write target
    via the same `set` flow. Don't delete source — apply pipeline calls
    `delete` separately.
  - `list` → `ListSecretsCommand` with
    `Filters: [{ Key: "name", Values: [prefix] }]` where prefix is
    `keyshelf/<name>/` or `keyshelf/`. Paginate via `NextToken`. Parse each
    secret name back into `{ keyPath, envName }` using the env set passed in
    `ctx.envs`, parallel to `parseSecretId` in gcp-sm.
  - `AwsAuthError` class + `isAuthError` helper. Detect:
    - SDK error names: `CredentialsProviderError`,
      `ExpiredTokenException`, `UnrecognizedClientException`,
      `InvalidSignatureException`, `AccessDeniedException` (latter only when
      it's actually a missing-credentials shape — be conservative).
    - HTTP status 401/403 from `$metadata.httpStatusCode`.
    Message: `"AWS authentication failed. Run 'aws sso login' or check your AWS credentials."`
  - Region resolution: read optional `ctx.config.region`. If present, pass
    it to the `SecretsManagerClient` constructor. If absent, construct the
    client with no region option and let the SDK's default chain resolve it
    (`AWS_REGION`, `AWS_DEFAULT_REGION`, or `~/.aws/config` profile).
  - Detect "no region resolvable" failures from the SDK (error name
    `ConfigurationError` / message includes `"Region is missing"`) and
    rethrow with a keyshelf-flavoured message:
    `"aws provider could not resolve a region for \"${keyPath}\". Set AWS_REGION, configure a default in your AWS profile, or pass region: '...' in the binding."`
    This is distinct from `AwsAuthError` — it's a configuration error, not
    a credential error.
  - Optional `kmsKeyId` from `ctx.config`. Only forwarded to
    `CreateSecretCommand`; `PutSecretValueCommand` inherits the secret's
    existing KMS key, so we don't pass it on updates.
  - Cache the client per region: lazy-create on first call, key by the
    resolved region string (or a `"__default__"` sentinel when the binding
    omits region — all such calls share one client and let the SDK pick).
- **Commit message**: `feat(providers): add aws secrets manager provider`

#### Task 1.3: Register `AwsSmProvider` in the default registry

- **Description**: Add the AWS provider to the registry constructed in
  `setup.ts`.
- **Files**: `packages/cli/src/providers/setup.ts`
- **Details**: One import + one `registry.register(new AwsSmProvider());`
  line. Keep alphabetical order (age, aws, gcp, plaintext, sops) for
  readability.

### Phase 2: Config-side wiring

#### Task 2.1: Add `AwsProviderOptions` type and `aws()` factory

- **Description**: Define the public-facing types and factory, parallel to
  `GcpProviderOptions` / `gcp()`.
- **Files**:
  - `packages/cli/src/config/types.ts`
  - `packages/cli/src/config/factories.ts`
  - `packages/cli/src/config/index.ts`
- **Details**:
  - `AwsProviderOptions = { region?: string; kmsKeyId?: string }`. Both
    optional — the SDK's region chain handles the common case where the
    user already has `AWS_REGION` or a profile default set.
  - Add `ProviderRef<"aws", AwsProviderOptions>` to the
    `BuiltinProviderRef` union.
  - Add `aws<const Options extends AwsProviderOptions>(options): ProviderRef<"aws", Options>`
    factory returning `{ __kind: "provider:aws", name: "aws", options }`.
  - Re-export `aws` and the `AwsProviderOptions` type from
    `config/index.ts` so consumers get them via `keyshelf/config`.

#### Task 2.2: Extend the zod schema

- **Description**: Add an `awsProviderSchema` to the discriminated union in
  `schema.ts`.
- **Files**: `packages/cli/src/config/schema.ts`
- **Details**: Mirror `gcpProviderSchema`. Both options optional:
  `region: z.string().min(1).optional()` and
  `kmsKeyId: z.string().min(1).optional()`. The options object is
  `.strict()` like the others so unknown keys still get rejected at parse
  time. Add to `providerRefSchema`'s `discriminatedUnion` entries.

#### Task 2.3: Extend the YAML loader

- **Description**: Recognise `!aws` in `keyshelf.yaml` and per-env files.
- **Files**: `packages/cli/src/config/yaml-loader.ts`
- **Details**:
  - Add `"aws"` to `PROVIDER_TAGS`.
  - Add an `aws` case to `providerRef`:
    ```ts
    case "aws":
      return aws(requireOptions<AwsProviderOptions>(options, [], label, "aws"));
    ```
    Empty required list — both `region` and `kmsKeyId` are optional.
    Re-read `requireOptions` to confirm it passes through optional keys
    when none are required; if it strips unknowns, switch to a manual pick
    that allows `region` and `kmsKeyId`.
  - Import `aws` factory and `AwsProviderOptions` at the top alongside the
    existing provider imports.

### Phase 3: Tests, docs, examples

#### Task 3.1: Unit tests for `AwsSmProvider`

- **Description**: New `packages/cli/test/unit/providers/aws-sm.test.ts`.
- **Files**: `packages/cli/test/unit/providers/aws-sm.test.ts` (new)
- **Details**: Port the GCP test file 1:1, replacing the GCP client mock
  with one that returns `Promise<...>` for each AWS command (the AWS SDK v3
  `client.send(command)` shape — mock `client.send` and switch on the
  command constructor). Cover:
  - Secret id derivation (with/without keyshelfName, with/without env,
    deeply nested paths, empty-string env). Note: paths use `/` not `__`,
    so the expected names differ from gcp's tests.
  - `resolve`: SecretString, SecretBinary, missing payload.
  - `validate`: 200 → true, ResourceNotFoundException → false, auth error
    → `AwsAuthError`.
  - `set`: create-then-version path, create-conflict → put path, KmsKeyId
    forwarded to create.
  - `copy`: reads source, writes target, does not delete source.
  - `delete`: idempotent on ResourceNotFoundException, force-deletes
    without recovery window.
  - `list`: prefix filter applied, pagination via NextToken, env
    disambiguation via `ctx.envs`.
  - `AwsAuthError` raised on each command's auth-failure shapes.

#### Task 3.2: Config-side tests

- **Description**: Extend existing config tests to cover the `aws` factory
  and `!aws` YAML tag.
- **Files**:
  - `packages/cli/test/unit/config.test.ts` (add a test alongside the
    existing `gcp` ones around line 279)
  - `packages/cli/test/unit/config/yaml-loader.test.ts` (or wherever
    `!gcp` is currently tested — locate by grep)
- **Details**: One test per: factory roundtrip, schema acceptance with
  no options (zero-config case — relying on SDK region chain), schema
  acceptance with explicit `region`, schema acceptance with `kmsKeyId`,
  schema rejection with unknown keys (strict mode), YAML `!aws` parsing
  in all three shapes (`!aws`, `!aws { region: ... }`,
  `!aws { region: ..., kmsKeyId: ... }`), and (if such a test exists for
  `!gcp`) env-file fallback merging.

#### Task 3.3: Spec, migration docs, examples

- **Description**: Document `aws` everywhere the other providers are
  documented.
- **Files**:
  - `docs/spec.md` — add an `### aws(options)` section after the existing
    `### gcp(options)` section (line ~199). Document `region` (optional —
    falls back to `AWS_REGION` / `AWS_DEFAULT_REGION` / profile default;
    explicit value overrides the chain), `kmsKeyId` (optional), the secret
    id format (`keyshelf/<name?>/<env?>/<path>`), and the AWS SDK
    credential chain. Call out that the zero-config form `aws()` works
    when the user already has an AWS profile.
  - `docs/migrating-from-v4.md` — add `!aws` to the YAML tags row.
  - `docs/migrating-without-v4-name.md` — add `!aws` next to the
    `!gcp` mention (line 29) so users with name-less v4 configs know they
    need to add `name:` if any secret uses `!aws`.
  - `examples/07-full.config.ts` — add an `aws({ region: "eu-west-1" })`
    binding to one key (e.g. a new `aws/staging` value alongside the
    existing `gcp` production binding) so the "full" example covers all
    four providers.
- **Commit message**: `docs: document aws secrets manager provider`

### Phase 4: Reconcile-side verification (sanity check, not new work)

The reconcile planner is provider-agnostic and keys off `storageScope` +
`providerName`. With AWS as `perEnv`, no planner code should need to
change. Verify by:

- Re-reading `packages/cli/src/reconcile/planner.ts` for any
  `name === "gcp"` special-cases (there shouldn't be any; if there are,
  it's a latent bug — flag and fix in a separate PR).
- Adding one planner test using `aws()` bindings parallel to the
  `gcp()` cases at `test/unit/reconcile/planner.test.ts:215` to lock in
  that the per-env partial-move logic works for any `perEnv` provider,
  not just gcp.

## Out of scope

- **Cross-region replication.** Secrets Manager supports it via
  `ReplicaRegions` on `CreateSecret`, but a single-region default keeps the
  config surface small. Add later if a user asks.
- **AWS Parameter Store (SSM) backend.** Different service, different
  semantics (no per-secret KMS key, hierarchical paths native, free tier).
  Could ship as `awsSsm` later; not bundled with this PR.
- **Resource policies / IAM grants.** The provider creates secrets under
  the credential's identity; managing IAM is the user's responsibility.
- **Migration tooling from `gcp` → `aws`.** `keyshelf up` + manual edits
  cover this: change the binding in the config, run `up`, it'll see the GCP
  entry as orphan and the AWS entry as missing. (It will *not* auto-rename
  across providers — by design, since byte-copying across clouds is a
  separate operational decision.)

## Open questions

- **Should `kmsKeyId` be settable per-env or only at the binding level?**
  Today it's per-binding (one `aws()` call = one KmsKey). If a user wants
  different KMS keys per env, they already declare separate `aws()` calls
  in `values:`. Probably fine; flag in review.
- **Do we want a `secretNamePrefix` override?** GCP doesn't have one. Skip
  unless someone asks — easier to add than to remove.
