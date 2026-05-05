import type { BuiltinProviderRef, NormalizedConfig, NormalizedRecord } from "../config/types.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { instanceKey } from "./internal/instance-key.js";
import type { ProviderListing } from "./planner.js";

export interface GatherListingsContext {
  config: NormalizedConfig;
  registry: ProviderRegistry;
  rootDir: string;
}

export interface ListingFailure {
  providerName: string;
  providerParams: unknown;
  error: Error;
}

export interface GatherListingsResult {
  listings: ProviderListing[];
  failures: ListingFailure[];
}

// Walk the config to find every distinct (provider, params) instance, then
// call list() once per instance. Failures are collected rather than thrown
// so a single broken provider doesn't block the rest of the plan.
export async function gatherListings(ctx: GatherListingsContext): Promise<GatherListingsResult> {
  const refs = collectProviderInstances(ctx.config);
  const listings: ProviderListing[] = [];
  const failures: ListingFailure[] = [];

  for (const ref of refs.values()) {
    const result = await listOne(ctx, ref);
    if (result.kind === "ok") {
      listings.push(result.listing);
    } else {
      failures.push(result.failure);
    }
  }

  return { listings, failures };
}

interface ListOk {
  kind: "ok";
  listing: ProviderListing;
}

interface ListErr {
  kind: "err";
  failure: ListingFailure;
}

async function listOne(
  ctx: GatherListingsContext,
  ref: BuiltinProviderRef
): Promise<ListOk | ListErr> {
  try {
    const provider = ctx.registry.get(ref.name);
    const stored = await provider.list({
      rootDir: ctx.rootDir,
      config: (ref.options ?? {}) as unknown as Record<string, unknown>,
      keyshelfName: ctx.config.name,
      envs: ctx.config.envs
    });
    return {
      kind: "ok",
      listing: {
        providerName: ref.name,
        providerParams: ref.options,
        storageScope: provider.storageScope,
        keys: stored
      }
    };
  } catch (err) {
    return {
      kind: "err",
      failure: {
        providerName: ref.name,
        providerParams: ref.options,
        error: err instanceof Error ? err : new Error(String(err))
      }
    };
  }
}

function collectProviderInstances(config: NormalizedConfig): Map<string, BuiltinProviderRef> {
  const out = new Map<string, BuiltinProviderRef>();
  for (const record of config.keys) {
    for (const ref of providerRefsOf(record)) {
      out.set(instanceKey(ref.name, ref.options), ref);
    }
  }
  return out;
}

function providerRefsOf(record: NormalizedRecord): BuiltinProviderRef[] {
  if (record.kind !== "secret") return [];
  const refs: BuiltinProviderRef[] = [];
  if (record.value !== undefined) refs.push(record.value);
  for (const ref of Object.values(record.values ?? {})) refs.push(ref);
  return refs;
}
