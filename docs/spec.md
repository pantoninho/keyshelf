# Keyshelf v5 — API Spec

Status: **locked** (Phase 0). Implementation phases reference this document as
the source of truth.

---

## Configuration entry point

A keyshelf project has exactly one config file at the repo root. The supported
formats are `keyshelf.config.ts` (default-exporting the result of
`defineConfig({ ... })`) and v4-style `keyshelf.yaml` + `.keyshelf/<env>.yaml`.
Both are first-class at runtime; the YAML form is parsed into the same internal
shape `defineConfig` produces.

```ts
import { defineConfig } from "keyshelf/config";

export default defineConfig({
  name: "myapp",
  envs: ["dev", "staging", "production"],
  groups: ["app", "ci"],
  keys: {
    /* ... */
  }
});
```

The `.env.keyshelf` file (app-name → key-path mapping) is unchanged from v4.

---

## `defineConfig` input

```ts
defineConfig({
  name:   string;            // required; stable identity for this config
  envs:   string[];          // required, non-empty, unique
  groups?: string[];          // optional, unique; if omitted, no group filtering
  keys:   KeyTree;           // required, non-empty
})
```

- `name` is the keyshelf project's stable identity. Providers that share a
  backend with other keyshelf configs (e.g. multiple apps using one GCP
  project) use `name` to namespace their secrets so they don't collide. Must
  match `/^[A-Za-z0-9_-]+$/` — letters, digits, hyphens, and underscores.
  Required; there is no fallback.
- `envs` enumerates every environment name the config recognises. Any
  `values` map elsewhere in the config may only use names from this list. There
  is no implicit / dynamic env support in v5.
- `groups` enumerates every group name. Any `group:` field in a key record
  must reference a name from this list. If `groups` is omitted, every key is
  effectively groupless and `--group` filtering is rejected at runtime.
- `keys` is a `KeyTree` (see below).

`defineConfig` returns an opaque `KeyshelfConfig` value (a branded structure
the loader recognises). The return type carries inferred env names, group
names, and the flattened key-path union, used to type-check `values` keys and
template references.

---

## `KeyTree` shape

A `KeyTree` is an object literal whose entries are one of:

| Form                                        | Interpretation                                  |
| ------------------------------------------- | ----------------------------------------------- |
| Bare scalar (`string \| number \| boolean`) | Sugar for `config({ value: <scalar> })`         |
| `config({ ... })`                           | Explicit config record (a leaf)                 |
| `secret({ ... })`                           | Explicit secret record (a leaf)                 |
| Object literal `{ ... }`                    | **Namespace** — recurse into a nested `KeyTree` |

Disambiguation rule: **factory calls are leaves; bare object literals are
namespaces.** This is enforced at the type level via the `__kind` discriminant
on factory return values, and at runtime by the validator.

Keys are addressed by `/`-separated paths derived from nesting:
`db: { password: secret({...}) }` flattens to `db/password`.

### String paths

A property name may itself be a `/`-separated path. This is purely a
flatten-the-nesting convenience for short configs:

```ts
keys: {
  'db/host': 'localhost',
  'db/port': 5432,
}
// equivalent to
keys: {
  db: {
    host: 'localhost',
    port: 5432,
  },
}
```

Validation rejects any pair of declarations that flatten to the same path.
A path is either a leaf or a namespace, never both — declaring `foo: 'bar'`
and `foo: { x: 'y' }` at the same level is a duplicate-path error.

---

## `config(...)`

```ts
config({
  group?: string;                                    // must be in groups[]
  optional?: boolean;                                // default false
  description?: string;                              // free-form
  value?: ConfigScalar | TemplateString;             // envless binding
  default?: ConfigScalar | TemplateString;           // alias for `value`
  values?: Partial<Record<EnvName, ConfigScalar | TemplateString>>;
  movedFrom?: string | string[];                     // rename hints for `keyshelf up`
})
```

- `ConfigScalar` is `string | number | boolean`.
- `TemplateString` is a string containing `${path/to/key}` references; see
  _Template interpolation_ below.
- `value` and `default` are aliases. **Setting both is a validation error.**
  The two names exist purely for legibility:
  - `value:` reads naturally for envless records (`token: config({ value: '...' })`)
  - `default:` reads naturally when paired with `values:` (the env-specific
    overrides are exceptions to the default).
- `values` keys are the env names where this record has an override. They are
  not required to cover every env in `envs`; missing envs fall back to
  `value` / `default`.

### Bare scalar sugar

```ts
log: {
  level: "info";
}
// equivalent to
log: {
  level: config({ value: "info" });
}
```

Bare scalars cannot carry `group`, `optional`, or `values` — use the explicit
factory if any of those apply.

---

## `secret(...)`

```ts
secret({
  group?: string;                                    // must be in groups[]
  optional?: boolean;                                // default false
  description?: string;
  value?: ProviderRef;                               // envless binding
  default?: ProviderRef;                             // alias for `value`
  values?: Partial<Record<EnvName, ProviderRef>>;
  movedFrom?: string | string[];                     // rename hints for `keyshelf up`
})
```

Same `value` / `default` / `values` semantics as `config`, with the
following differences:

- All bindings (`value`, `default`, each entry in `values`) **must** be a
  `ProviderRef` — the result of a provider factory call. Plaintext secrets are
  not supported.
- A `secret` must have _some_ binding that can resolve in the active env.
  Concretely: at least one of `value`/`default`, or a matching entry in
  `values`. The validator enforces that `secret(...)` declarations are not
  empty; the resolver enforces presence per active env.
- `optional: true` skips the key (returns `undefined`) when no binding applies
  for the active env, or when the bound provider raises a not-found error.
  Provider-side errors that are _not_ not-found (auth, network, etc.) still
  propagate even for optional secrets.

---

## Provider factories

Provider factories are imported from `keyshelf/config` and return a
`ProviderRef` carrying a `__kind: 'provider:<name>'` discriminant.

### `age(options)`

```ts
age({
  identityFile: string;   // path to the age identity (private key) — used to
                          // decrypt and to derive the recipient on `set`
  secretsDir: string;     // directory holding the .age ciphertext files
})
```

Both fields are required. Ciphertext is stored as
`<secretsDir>/<keyPath-with-/-as-_>.age`.

### `gcp(options)`

```ts
gcp({
  project: string;        // GCP project hosting the Secret Manager secrets
})
```

The Secret Manager secret id is derived from the keyshelf config `name`,
the active `envName`, and the key path:

- env-scoped: `keyshelf__<name>__<env>__<keyPath-with-/-as-__>`
- envless: `keyshelf__<name>__<keyPath-with-/-as-__>`

`/` is not a valid character in GCP secret ids, so path separators are
mangled to `__`.

### `sops(options)`

```ts
sops({
  identityFile: string;   // path to the age identity used to unlock the data key
  secretsFile: string;    // path to the encrypted JSON document
})
```

Phase 4 ports these providers to the new `ProviderContext`; option shapes
above are pinned.

---

## Resolution order

For each declared key, given an active `envName`:

1. If `values[envName]` is set → use that binding.
2. Else if `value` or `default` is set → use that binding.
3. Else if the key is `optional` → skip (resolver returns `undefined`).
4. Else → resolver raises a required-key error.

For a binding that is a `ProviderRef`, the resolver invokes the provider with
a `ProviderContext` (Phase 4 shape) and uses the returned string.

For a binding that is a `ConfigScalar`, the value is used as-is (numbers and
booleans are stringified at the env-mapping boundary, not in the config
representation).

For a binding that is a `TemplateString`, see below.

---

## Template interpolation

A config binding may contain `${path/to/key}` references. The resolver
substitutes each reference with the resolved value of the named key. Rules:

- References resolve **after** group/filter selection has run. Behavior when
  a referenced key is filtered out is defined under
  _Decision: template references under group filtering_ below.
- Cyclic references are a validation error.
- Templates may reference both `config` and `secret` keys. Referencing a
  secret key from a template-rendered output is allowed but should be used
  carefully — if the template is written to `.env.keyshelf` output the secret
  ends up in the rendered env var.
- Escaping: `$${...}` produces a literal `${...}`.

Templates are only valid inside `config(...)` bindings, not inside
`secret(...)` bindings.

---

## `movedFrom`

Both `config(...)` and `secret(...)` accept an optional `movedFrom: string | string[]`.
It is a hint to `keyshelf up` that this key used to live at a different path. The
planner uses it to disambiguate renames when multiple orphan storage entries
plausibly match a new key. The string (or array of strings) is the previous
key path(s); array form covers a key that has been renamed multiple times
before the user got around to running `up`.

The validator rejects a `movedFrom` entry that collides with any declared key
path in the same config — the old path must be retired in the schema for the
hint to make sense.

---

## Validation rules (for Phase 2)

The Phase 2 validator must enforce, in addition to the type-level constraints:

1. `value` and `default` mutually exclusive on any single record.
2. Every key in any `values` map must be in the top-level `envs` list.
3. Every `group` field must be in the top-level `groups` list (or the
   declaration is rejected if `groups` is absent).
4. `secret({...})` must have at least one binding (`value` / `default` /
   non-empty `values`).
5. Duplicate flattened paths are rejected (covers string-path / nested
   mixing — e.g. `foo: { x: 'a' }` and `'foo/x': 'b'` declared at the same
   level).
6. A leaf path may not be a prefix of any other leaf path. Declaring `foo`
   as a leaf and `'foo/x'` as another leaf in the same config is rejected:
   any given path is either a leaf or a namespace prefix, never both.
7. Path segments must match `/^[A-Za-z][A-Za-z0-9-]*$/`. The `/` separator
   is reserved. `_` is forbidden so per-provider storage ids (which mangle
   `/` into `_` for age and `__` for gcp) round-trip unambiguously when
   listed.
8. Template references in `config` bindings must resolve to declared key
   paths and must not form cycles.
9. `.env.keyshelf` references must point to declared key paths
   (loader-time validation against the flattened key set).
10. `movedFrom` entries must NOT collide with a declared key path in the
    same config (the old path must be retired in the schema).

---

## Decisions (open questions from issue #78)

### Decision: reserved namespace conflict edge case

**Question.** What does this mean?

```ts
keys: {
  foo: { value: 'bar' },
}
```

— is `foo` a leaf record with field `value: 'bar'`, or a namespace with a
sub-key `foo/value`?

**Decision.** It is a **namespace**. Object literals are _always_ namespaces.
A leaf record requires an explicit `config(...)` or `secret(...)` factory
call. Therefore the example above declares a key at path `foo/value` whose
default is the string `'bar'`.

To declare a leaf at path `foo`, use:

```ts
keys: {
  foo: 'bar',                   // bare scalar, sugar for config({ value: 'bar' })
  // or
  foo: config({ value: 'bar' }),
}
```

A path is either a leaf or a namespace, never both. Declaring `foo` as a
leaf (scalar / factory) and `foo/x` as another leaf in the same config is
rejected by validation rule 6 — there is no shape that supports both
simultaneously, by design.

**Why this rule.** It removes ambiguity entirely: a property's _shape_
(literal object vs factory return) is the disambiguator, never the property's
_name_. The validator can check the rule by inspecting `__kind` without
reasoning about the schema of common namespace names.

**How to apply.** Phase 2 validator surfaces a clear error message when a
nested object accidentally contains keys that look like factory options
(e.g. `{ value: ..., values: { ... } }`) — suggest the explicit factory.

### Decision: `.env.keyshelf` template behavior under group filtering

**Question.** When `--group app` is active and a `.env.keyshelf` template
references a key that belongs to a different group (e.g. `${ci/token}`), what
happens?

Options considered:

- **error** — fail the whole render
- **skip** — omit the resulting env var entirely
- **empty** — set the env var to an empty string

**Decision.** **Skip the env var, with a stderr warning.** If any key
referenced by an env-var template is filtered out (by `--group`, `--filter`,
or because it is optional and unresolved), the entire env var is omitted from
the rendered output, and a warning of the form

```
keyshelf: skipping ENV_VAR — referenced key 'ci/token' is filtered out
```

is written to stderr.

**Why this rule.** Group filtering is a deliberate "I want a partial render"
operation; refusing to render anything because an unrelated group's keys are
absent defeats the point. Empty-string fallback is dangerous (silent bad
input to consumer apps). Skip-with-warning preserves auditability without
forcing the user to maintain group-segmented `.env.keyshelf` files. The
stderr warning is the audit trail.

**How to apply.** Phase 3 resolver returns a per-env-var status. Phase 5
`run` and `ls` commands consume that status to decide whether to emit the
var. Tests cover: (a) all keys filtered in → var renders; (b) any referenced
key filtered out → var skipped + warning; (c) optional unresolved key →
var skipped + warning. Same behavior for `--filter` and unset optional keys
— the rule is "if any referenced key is unavailable in the active selection,
skip the var."

---

## Out of scope (restated for clarity)

- Dynamic / undeclared env names (no `--env preview-pr-123` until the user
  declares it in `envs`).
- TS-format `.env.keyshelf`. Stay with the v4 format.
- Variation axes beyond env (region, tenant, …). The `values` naming was
  chosen to leave the door open, but no implementation work happens in v5.
- Plaintext secrets. `secret(...)` always requires a `ProviderRef`. If you
  truly want a plaintext "secret-shaped" value, use `config(...)` and accept
  that it will be treated as non-sensitive by the tooling.
