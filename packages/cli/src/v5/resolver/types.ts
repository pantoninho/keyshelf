import type { AppMapping } from "../../config/app-mapping.js";
import type { NormalizedRecord } from "../config/types.js";

export interface ResolvedV5Key {
  path: string;
  value: string;
}

export interface V5ValidationError {
  path: string;
  message: string;
  error?: Error;
}

export interface V5TopLevelError {
  message: string;
  error?: Error;
}

export interface V5ValidationResult {
  topLevelErrors: V5TopLevelError[];
  keyErrors: V5ValidationError[];
}

export type V5SkipCause =
  | { type: "group-filter"; activeGroups: readonly string[] }
  | { type: "path-filter"; activePrefixes: readonly string[] }
  | { type: "optional-no-value" }
  | { type: "optional-not-found" }
  | { type: "template-ref-unavailable"; reference: string; referenceCause: V5SkipCause };

export type V5KeyResolutionStatus =
  | {
      path: string;
      status: "resolved";
      value: string;
    }
  | {
      path: string;
      status: "filtered";
      cause: V5SkipCause;
    }
  | {
      path: string;
      status: "skipped";
      cause: V5SkipCause;
    }
  | {
      path: string;
      status: "error";
      message: string;
      error?: Error;
    };

export interface V5Resolution {
  statuses: V5KeyResolutionStatus[];
  resolved: ResolvedV5Key[];
  statusByPath: Map<string, V5KeyResolutionStatus>;
}

export type RenderedV5EnvVar =
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
      cause: V5SkipCause;
      mapping: AppMapping;
    };

export interface SelectedV5Record {
  record: NormalizedRecord;
  selected: boolean;
  cause?: V5SkipCause;
}
