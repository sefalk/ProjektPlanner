import { describe, it, expect } from 'vitest'
import { isPasswordValid, PASSWORD_RULES, PASSWORD_MIN_LENGTH } from '../passwordPolicy'

describe('passwordPolicy', () => {
  it('accepts a password meeting every rule', () => {
    expect(isPasswordValid('Pw123456789!')).toBe(true)
  })

  it('rejects a too-short password', () => {
    expect(isPasswordValid('Aa1!')).toBe(false)
    expect('Aa1!'.length).toBeLessThan(PASSWORD_MIN_LENGTH)
  })

  it('rejects a long password missing character classes', () => {
    expect(isPasswordValid('abcdefghijklmnop')).toBe(false) // no upper/digit/special
  })

  it('exposes one rule per requirement', () => {
    expect(PASSWORD_RULES).toHaveLength(4)
    // the min-length rule reflects the constant
    expect(PASSWORD_RULES[0].test('x'.repeat(PASSWORD_MIN_LENGTH))).toBe(true)
    expect(PASSWORD_RULES[0].test('x'.repeat(PASSWORD_MIN_LENGTH - 1))).toBe(false)
  })
})
