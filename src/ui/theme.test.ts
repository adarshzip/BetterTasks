import { describe, it, expect } from 'vitest'
import { readableAccent } from './theme'

const LIGHT = {
  dark: false,
  bg: '#ffffff',
  surface: '#f8f9fa',
  text: '#202124',
  muted: '#5f6368',
  border: '#dadce0',
  accent: '#1a73e8',
}

const DARK = { ...LIGHT, dark: true }

describe('readableAccent', () => {
  it('darkens a pale colour in light mode', () => {
    // The fallback palette's banana yellow — unreadable as text on white.
    expect(readableAccent('#fdd663', LIGHT)).not.toBe('#fdd663')
  })

  it('leaves a colour unchanged in dark mode', () => {
    expect(readableAccent('#fdd663', DARK)).toBe('#fdd663')
  })

  it('leaves an already-dark colour unchanged in light mode', () => {
    // A real Calendar colour like Tomato is already high-contrast on white.
    expect(readableAccent('#d50000', LIGHT)).toBe('#d50000')
  })

  it('returns the input unchanged for an unparseable colour', () => {
    expect(readableAccent('not-a-hex', LIGHT)).toBe('not-a-hex')
  })
})
