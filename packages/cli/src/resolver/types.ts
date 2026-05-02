import type { AppMapping } from "../config/app-mapping.js";
import type { NormalizedRecord } from "../config/types.js";

export interface ResolvedKey {
  path: string;
  value: string;
}

export interface ValidationError {
  path: string;
  message: string;
  error?: Error;
}

export interface TopLevelError {
  message: string;
  error?: Error;
}

export interface ValidationResult {
  topLevelErrors: TopLevelError[];
  keyErrors: ValidationError[];
}

export type SkipCause =
  | { type: "group-filter"; activeGroups: readonly string[] }
  | { type: "path-filter"; activePrefixes: readonly string[] }
  | { type: "optional-no-value" }
  | { type: "optional-not-found" }
  | { type: "template-ref-unavailable"; reference: string; referenceCause: SkipCause };

export type KeyResolutionStatus =
  | {
      path: string;
      status: "resolved";
      value: string;
    }
  | {
      path: string;
      status: "filtered";
      cause: SkipCause;
    }
  | {
      path: string;
      status: "skipped";
      cause: SkipCause;
    }
  | {
      path: string;
      status: "error";
      message: string;
      error?: Error;
    };

export interface Resolution {
  statuses: KeyResolutionStatus[];
  resolved: ResolvedKey[];
  statusByPath: Map<string, KeyResolutionStatus>;
}

export type RenderedEnvVar =
  | {
      envVar: string;
      status: "rendered";
      value: string;
      mapping: AppMapping;
    }
  | {
      envVar: string;
      status: "skipped";
      keyPath: string;
      cause: SkipCause;
      mapping: AppMapping;
    };

export interface SelectedRecord {
  record: NormalizedRecord;
  selected: boolean;
  cause?: SkipCause;
}
