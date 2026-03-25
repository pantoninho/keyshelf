# Optional secrets fail when default provider is configured but secret is missing

## Bug

Optional secrets (`!secret { optional: true }`) should be skipped when no value is available. However, when a default provider is configured in the environment file, optional secrets always attempt provider resolution — and if the secret doesn't exist in the provider, the error propagates instead of being gracefully skipped.

## Steps to reproduce

```yaml
# keyshelf.yaml
keys:
  pulumi:
    config-passphrase: !secret
      optional: true
```

```yaml
# .keyshelf/production.yaml
default-provider:
  name: gcp
  project: my-project

keys: {}
```

```bash
keyshelf run --env production -- printenv
# Error: 5 NOT_FOUND: Secret [.../keyshelf__production__pulumi__config-passphrase] not found
```

## Expected behavior

Optional secrets that fail provider resolution should be skipped (return `undefined`), same as when no provider is configured.

## Root cause

In `src/resolver/index.ts`, `resolveKey()` step 3 (lines 67–75) unconditionally calls `provider.resolve()` without checking `key.optional`:

```typescript
// 3. Secret with default provider
if (key.isSecret && env.defaultProvider) {
  const provider = registry.get(env.defaultProvider.name);
  const ctx = { keyPath: key.path, envName, config: { ...env.defaultProvider.options } };
  return provider.resolve(ctx);  // throws if secret doesn't exist
}

// 5. Error (required secret) or skip (optional secret)
if (key.optional) {
  return undefined;  // never reached for optional secrets with a default provider
}
```

## Suggested fix

Wrap the provider call in step 3 with a try/catch when the key is optional:

```typescript
if (key.isSecret && env.defaultProvider) {
  const provider = registry.get(env.defaultProvider.name);
  const ctx = { keyPath: key.path, envName, config: { ...env.defaultProvider.options } };
  try {
    return await provider.resolve(ctx);
  } catch {
    if (key.optional) return undefined;
    throw;
  }
}
```

The same issue likely applies to step 2 (provider-tagged overrides in env files) — `resolveViaProvider()` also doesn't account for optional keys.

## Workaround

Add a plaintext override in the env file to prevent provider resolution:

```yaml
keys:
  pulumi:
    config-passphrase: ""
```
