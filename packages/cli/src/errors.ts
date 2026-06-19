/**
 * The closed set of structured error codes. Additive growth is fine; renaming a
 * code is a breaking change to the machine contract. See docs/reference.md.
 */
export const ERROR_CODES = [
  'NOT_INITIALIZED',
  'ALREADY_INITIALIZED',
  'SHELF_NOT_FOUND',
  'SCHEMA_NOT_FOUND',
  'ENVIRONMENT_NOT_FOUND',
  'PROVIDER_NOT_FOUND',
  'UNKNOWN_KEY',
  'MISSING_REQUIRED',
  'INVALID_KEY_NAME',
  'ADAPTER_UNAVAILABLE',
  'PROVIDER_AUTH',
  'SECRET_NOT_FOUND',
  'NO_INPUT',
  'MALFORMED_FILE',
  'ADAPTER_ERROR',
  'EXEC_FAILED',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

/**
 * A domain error carrying a stable machine `code`, a human `message`, and
 * arbitrary structured `fields` (e.g. `path`, `shelf`, `environment`). Rendered
 * as `{ "error": { code, message, ...fields } }` in `--json` mode.
 */
export class KeyshelfError extends Error {
  readonly code: ErrorCode
  readonly fields: Record<string, unknown>

  constructor(code: ErrorCode, message: string, fields: Record<string, unknown> = {}) {
    super(message)
    this.name = 'KeyshelfError'
    this.code = code
    this.fields = fields
  }

  toJSON(): {code: ErrorCode; message: string} & Record<string, unknown> {
    return {code: this.code, message: this.message, ...this.fields}
  }
}
