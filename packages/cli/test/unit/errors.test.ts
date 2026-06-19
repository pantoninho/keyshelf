import {describe, expect, it} from 'vitest'
import {ERROR_CODES, KeyshelfError} from '../../src/errors.js'

describe('KeyshelfError', () => {
  it('serializes to { code, message, ...fields }', () => {
    const err = new KeyshelfError('ALREADY_INITIALIZED', 'already there', {path: '/x/.keyshelf'})
    expect(err.toJSON()).toEqual({
      code: 'ALREADY_INITIALIZED',
      message: 'already there',
      path: '/x/.keyshelf',
    })
  })

  it('is an Error with a stable code', () => {
    const err = new KeyshelfError('NOT_INITIALIZED', 'nope')
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('NOT_INITIALIZED')
  })

  it('exposes the full closed code set', () => {
    expect(ERROR_CODES).toContain('ALREADY_INITIALIZED')
    expect(ERROR_CODES).toContain('SECRET_NOT_FOUND')
    expect(ERROR_CODES).toContain('MALFORMED_FILE')
    // The committed enum size — bump deliberately when adding a code.
    expect(ERROR_CODES).toHaveLength(16)
  })
})
