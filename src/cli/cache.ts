import { join } from "node:path";
import type { LoadedConfig } from "../config/loader.js";
import { SecretCache } from "../cache/index.js";

export function createCache(config: LoadedConfig): SecretCache | undefined {
  const ttl = config.env.cache?.ttl;
  if (!ttl) return undefined;
  return new SecretCache({ cacheDir: join(config.rootDir, ".keyshelf", "cache"), ttl });
}
