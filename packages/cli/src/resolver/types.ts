export interface ResolvedKey {
  path: string;
  value: string;
}

export interface ValidationError {
  path: string;
  message: string;
  error?: Error;
}
