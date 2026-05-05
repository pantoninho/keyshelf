import { newEnvSet, type EnvSet } from "./envs.js";
import { upsertEnvSet, type InstanceState } from "./instance.js";

export interface InstanceDiff {
  matched: Map<string, EnvSet>;
  unmetByPath: Map<string, EnvSet>;
  orphansByPath: Map<string, EnvSet>;
}

export function diffInstance(state: InstanceState): InstanceDiff {
  const partitioner = new DiffPartitioner(state);
  return partitioner.partition();
}

class DiffPartitioner {
  readonly matched = new Map<string, EnvSet>();
  readonly unmetByPath = new Map<string, EnvSet>();
  readonly orphansByPath = new Map<string, EnvSet>();

  constructor(readonly state: InstanceState) {}

  partition(): InstanceDiff {
    this.partitionDesired();
    this.partitionActual();
    return {
      matched: this.matched,
      unmetByPath: this.unmetByPath,
      orphansByPath: this.orphansByPath
    };
  }

  private partitionDesired(): void {
    for (const [path, desiredEnvs] of this.state.desired) {
      const actualEnvs = this.state.actual.get(path) ?? newEnvSet();
      for (const env of desiredEnvs) {
        const bucket = actualEnvs.has(env) ? this.matched : this.unmetByPath;
        upsertEnvSet(bucket, path).add(env);
      }
    }
  }

  private partitionActual(): void {
    for (const [path, actualEnvs] of this.state.actual) {
      const desiredEnvs = this.state.desired.get(path) ?? newEnvSet();
      for (const env of actualEnvs) {
        if (!desiredEnvs.has(env)) {
          upsertEnvSet(this.orphansByPath, path).add(env);
        }
      }
    }
  }
}
