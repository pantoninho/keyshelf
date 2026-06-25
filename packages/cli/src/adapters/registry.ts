import os from "node:os";
import path from "node:path";
import { KeyshelfError } from "../errors.js";
import { loadEnvironment } from "../loader.js";
import type { LoadedEnvironment, Provider } from "../model.js";
import type { ResolveDeps } from "../resolve.js";
import type { Adapter } from "./adapter.js";
import { FakeAdapter, fileStore } from "./fake.js";
import { GcpAdapter } from "./gcp.js";
import { SopsAdapter } from "./sops.js";

/**
 * Everything an adapter needs to bind to a concrete environment's store. The
 * reference-adapter convention composes a remote secret's name from
 * `keyshelf__{project}__{shelf}__{stage}__{key}` (docs/reference.md), so the
 * project, shelf, and stage names are part of the construction context,
 * not just the provider config.
 */
export interface AdapterContext {
  /** The project root directory (where `.keyshelf/` lives). */
  projectDir: string;
  /** The project name from `config.yaml` (namespaces secrets). */
  project: string;
  /** The shelf of the environment being resolved. */
  shelf: string;
  /** The stage of the environment being resolved. */
  stage: string;
}

/** Where the file-backed fake store lives, relative to the project root. */
const FAKE_STORE_FILE = path.join(".keyshelf", ".fake-store.json");

/**
 * Expand a leading `~` or `~/` in a config path to the user's home directory.
 * Tilde expansion is a shell convenience, not a filesystem feature: `path.resolve`
 * treats `~` as a literal segment, so an unexpanded `~/key` silently resolves to
 * `<projectDir>/~/key` — a path that almost never exists, with a baffling error.
 * Only a bare `~` or a `~/`-prefixed path is expanded; `~user` is left untouched,
 * since resolving another user's home needs a passwd lookup keyshelf does not do.
 */
function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * Read a required string field from a provider's config, or fail with a
 * `MALFORMED_FILE` naming the config file and the missing field. Adapter config
 * shape is enforced here, at construction, rather than in the (pure, adapter-
 * agnostic) validator.
 */
function requireStringField(provider: Provider, field: string, ctx: AdapterContext): string {
  const value = provider[field];
  if (typeof value === "string" && value.length > 0) return value;
  throw new KeyshelfError(
    "MALFORMED_FILE",
    `Provider with adapter '${provider.adapter}' is missing required field '${field}'.`,
    { file: path.join(ctx.projectDir, ".keyshelf", "config.yaml"), reason: `missing '${field}'` }
  );
}

/**
 * The sops store's default layout: a per-environment sibling encrypted file
 * `.keyshelf/{shelf}/{stage}.secrets.yaml` (docs/reference.md, ADR-0002). A
 * provider may override the layout with a `store:` template using `{shelf}` and
 * `{stage}` placeholders, resolved relative to the project root.
 */
function sopsStorePath(provider: Provider, ctx: AdapterContext): string {
  const template =
    typeof provider.store === "string"
      ? provider.store
      : path.join(".keyshelf", "{shelf}", "{stage}.secrets.yaml");
  const rel = template.replaceAll("{shelf}", ctx.shelf).replaceAll("{stage}", ctx.stage);
  return path.resolve(ctx.projectDir, rel);
}

/**
 * Construct the {@link Adapter} for a provider. The provider's `adapter`
 * discriminator selects the implementation; an unknown name is a structured
 * `ADAPTER_UNAVAILABLE` (the backend prerequisite — a known adapter — is
 * missing). New adapters (`sops`, `gcp`) slot in by adding a branch here without
 * reshaping the interface or its callers.
 */
export function createAdapter(provider: Provider, ctx: AdapterContext): Adapter {
  switch (provider.adapter) {
    case "fake": {
      // Persist to a JSON file under the project so a value written in one
      // `keyshelf` process is resolvable by a separate process later (the E2E
      // suite spawns the real binary across invocations). The namespace mirrors
      // the reference convention `keyshelf__{project}__{shelf}__{stage}` so the
      // same key in different environments stays distinct in the shared store.
      const storePath =
        typeof provider.store === "string"
          ? path.resolve(ctx.projectDir, provider.store)
          : path.join(ctx.projectDir, FAKE_STORE_FILE);
      const namespace = `keyshelf__${ctx.project}__${ctx.shelf}__${ctx.stage}`;
      return new FakeAdapter(fileStore(storePath), namespace);
    }

    case "sops": {
      // The store is a per-environment encrypted sibling file; recipients come
      // from the project's `.sops.yaml`, which sops discovers by walking up from
      // the store path — so the adapter runs sops with the project root as cwd.
      // An optional `ageKeyFile` locates the decryption identity per-environment
      // (ADR-0010); a leading `~`/`~/` expands to the user's home, then it is
      // resolved relative to the project root, like `store`.
      const ageKeyFile =
        typeof provider.ageKeyFile === "string"
          ? path.resolve(ctx.projectDir, expandHome(provider.ageKeyFile))
          : undefined;
      return new SopsAdapter({
        storePath: sopsStorePath(provider, ctx),
        cwd: ctx.projectDir,
        ageKeyFile
      });
    }

    case "gcp": {
      // One secret per key in the provider's GCP project, named by the reference
      // convention `keyshelf__{project}__{shelf}__{stage}__{key}`; the namespace is
      // the `keyshelf__{project}__{shelf}__{stage}` prefix so the same key across
      // environments stays distinct in the shared backend. `location` is an
      // optional replication hint (absent/`global` ⇒ automatic).
      const projectId = requireStringField(provider, "projectId", ctx);
      const location = typeof provider.location === "string" ? provider.location : undefined;
      const namespace = `keyshelf__${ctx.project}__${ctx.shelf}__${ctx.stage}`;
      return new GcpAdapter({ projectId, namespace, location });
    }

    default: {
      throw new KeyshelfError(
        "ADAPTER_UNAVAILABLE",
        `Unknown adapter '${provider.adapter}'. No adapter is registered for it.`,
        { adapter: provider.adapter }
      );
    }
  }
}

/**
 * Build the adapter for an environment, looking its provider up in its own
 * config. Construction is offline and credential-free for every reference
 * adapter (ADR-0008): the gcp client is constructed but never called until
 * `resolve`/`write`, so `ls` can build an adapter solely to compute offline
 * addresses via {@link Adapter.metadata}.
 */
export function adapterForEnvironment(projectDir: string, loaded: LoadedEnvironment): Adapter {
  const { shelf, name, provider: providerName } = loaded.environment;
  const provider = providerName === undefined ? undefined : loaded.config.providers[providerName];
  if (provider === undefined) {
    throw new KeyshelfError(
      "PROVIDER_NOT_FOUND",
      `Environment '${shelf}/${name}' references undefined provider '${providerName}'.`,
      { shelf, environment: `${shelf}/${name}`, provider: providerName }
    );
  }
  return createAdapter(provider, {
    projectDir,
    project: loaded.config.project,
    shelf,
    stage: name
  });
}

/**
 * Assemble the {@link ResolveDeps} a `run`/`validate` needs for a project: build
 * each environment's adapter from its own provider config, and load referenced
 * `{shelf}/{stage}` environments from the same project root. A `!ref` therefore
 * resolves through the *target* environment's provider, not the consumer's.
 */
export function resolveDepsFor(projectDir: string): ResolveDeps {
  return {
    adapterFor: (loaded) => adapterForEnvironment(projectDir, loaded),
    loadEnvironment: (shelf, stage) => loadEnvironment(projectDir, shelf, stage)
  };
}
