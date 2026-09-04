import { describe, it, expect } from 'vitest'
import { applyClassPrefix, stripClassPrefix } from './title'

describe('applyClassPrefix', () => {
  it('adds the class in brackets', () => {
    expect(applyClassPrefix('HW1', 'QBIO 401')).toBe('[QBIO 401] HW1')
  })

  it('replaces an existing prefix rather than stacking them', () => {
    expect(applyClassPrefix('[MATH 458] HW1', 'QBIO 401')).toBe('[QBIO 401] HW1')
  })

  it('removes the prefix when the class is cleared', () => {
    expect(applyClassPrefix('[QBIO 401] HW1', undefined)).toBe('HW1')
  })

  it('leaves an unclassed title alone', () => {
    expect(applyClassPrefix('HW1', undefined)).toBe('HW1')
  })
})

describe('stripClassPrefix', () => {
  it('removes a prefix matching the class', () => {
    expect(stripClassPrefix('[QBIO 401] HW1', 'QBIO 401')).toBe('HW1')
  })

  it('matches case-insensitively', () => {
    expect(stripClassPrefix('[qbio 401] HW1', 'QBIO 401')).toBe('HW1')
  })

  // Guessing that any bracketed prefix is ours would eat the user's own text.
  it('leaves a prefix that is not the class', () => {
    expect(stripClassPrefix('[draft] essay', 'QBIO 401')).toBe('[draft] essay')
  })

  it('leaves everything alone when there is no class', () => {
    expect(stripClassPrefix('[draft] essay', undefined)).toBe('[draft] essay')
  })

  it('survives a round trip', () => {
    const stored = applyClassPrefix('HW1', 'QBIO 401')
    expect(stripClassPrefix(stored, 'QBIO 401')).toBe('HW1')
  })

  it('does not double-strip on repeated application', () => {
    let stored = applyClassPrefix('HW1', 'QBIO 401')
    stored = applyClassPrefix(stripClassPrefix(stored, 'QBIO 401'), 'QBIO 401')
    expect(stored).toBe('[QBIO 401] HW1')
  })
})
