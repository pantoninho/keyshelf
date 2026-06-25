# Locating the sops age identity per-environment: the `ageKeyFile` provider field

## Decision

The sops provider config gains one optional field, `ageKeyFile`, pointing at an
age identity file. When present, keyshelf resolves it relative to the project root
and exports it to every `sops` invocation for that environment as
`SOPS_AGE_KEY_FILE`. When absent, behavior is unchanged: sops uses the ambient
`SOPS_AGE_KEY_FILE` and its other native key sources.

```yaml
providers:
  local:
    adapter: sops
    ageKeyFile: ".keyshelf/age.key" # optional; resolved relative to the project root
```

This extends — and does not reshape — the two-method adapter contract (ADR-0002),
the provider config model, or the conformance suites (ADR-0005). It is **additive,
not breaking**: existing configs with no `ageKeyFile` resolve exactly as before.

## Why

ADR-0002 says, flatly, that "authentication is delegated to each backend's native
credential mechanism" and that recipients "are governed by the project's native
`.sops.yaml`, not by keyshelf." This ADR is the first config knob that touches
sops authentication, so the boundary it draws is load-bearing and recorded here
precisely:

- **keyshelf locates; sops manages.** `ageKeyFile` only tells keyshelf _where the
  key is_ so it can set sops's own `SOPS_AGE_KEY_FILE`. keyshelf never reads,
  parses, derives, or rotates the key — all key handling stays inside sops. The
  _mechanism_ is still fully delegated, exactly as ADR-0002 requires; only the
  _location_ moves from ambient process env into per-environment config.
- **Recipients are untouched.** This affects _who decrypts on this machine_, not
  _who can decrypt_ (encryption recipients), which remain 100% governed by
  `.sops.yaml`. So the load-bearing part of ADR-0002 — keyshelf does not manage
  recipients — is preserved.
- **Per-environment, not process-wide.** Because the adapter is rebuilt per
  environment (`adapterForEnvironment`), different shelves/stages can name
  different identity files — something a single ambient `SOPS_AGE_KEY_FILE` cannot
  express. This is the concrete win over the env-var-only status quo: a project
  whose environments decrypt under different age identities can declare that in
  committed config instead of orchestrating env vars per `keyshelf run`.

The field is named `ageKeyFile`, not a generic `identity`, on purpose:
`SOPS_AGE_KEY_FILE` only governs **age** identities. PGP uses the gpg agent;
KMS/GCP/Azure use cloud credentials. A generic name would over-promise coverage
keyshelf does not provide. A future backend wanting its own auth-location knob
adds its own explicitly-named field under the same "locate, don't manage"
boundary.

## Consequences

- Wrong or missing key behavior is unchanged: sops failing to recover the data key
  still maps to `PROVIDER_AUTH` via the adapter's existing error mapping
  (ADR-0005). `ageKeyFile` adds no new error code.
- The field is resolved relative to the project root, mirroring `store`; an
  absolute path is honored as-is (`path.resolve`).
- keyshelf still does not manage recipients, rotation, or any non-age sops key
  source; those remain `.sops.yaml` / native-mechanism concerns (ADR-0002).
- The conformance suite proves the field drives decryption end-to-end with **no
  ambient `SOPS_AGE_KEY_FILE`**, so the delegation is exercised, not assumed.
