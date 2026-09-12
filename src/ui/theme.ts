/**
 * Theme for the side panel.
 *
 * The panel is our own page, so we follow the browser's colour scheme rather
 * than sniffing Calendar's background. The palette still mirrors Calendar's so
 * the two columns sit together comfortably.
 */

export interface Theme {
  dark: boolean
  bg: string
  surface: string
  text: string
  muted: string
  border: string
  accent: string
}

const DARK: Theme = {
  dark: true,
  bg: '#1b1b1b',
  surface: '#242424',
  text: '#e3e3e3',
  muted: '#9aa0a6',
  border: '#3c4043',
  accent: '#8ab4f8',
}

const LIGHT: Theme = {
  dark: false,
  bg: '#ffffff',
  surface: '#f8f9fa',
  text: '#202124',
  muted: '#5f6368',
  border: '#dadce0',
  accent: '#1a73e8',
}

export function detectTheme(): Theme {
  return prefersDark().matches ? DARK : LIGHT
}

function prefersDark(): MediaQueryList {
  return window.matchMedia('(prefers-color-scheme: dark)')
}

/** Re-renders when the browser theme flips. Returns a disposer. */
export function watchTheme(onChange: () => void): () => void {
  const query = prefersDark()
  const listener = (): void => onChange()
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

/**
 * A category colour used as text, on light mode.
 *
 * The fallback palette (`colorFor` in grouping.ts) is Google's own *dark*
 * Calendar theme colours — pale pastels meant to sit on a near-black surface.
 * Used as text on this panel's white background in light mode, several of
 * them (banana yellow, pale blue) fail contrast badly. A colour pulled from a
 * real Calendar event can be light for the same reason if the user picked a
 * pastel there. Darkening only kicks in when the colour is actually too
 * light, so an already-dark, high-contrast Calendar colour passes through
 * unchanged rather than getting muddied.
 */
export function readableAccent(hex: string, theme: Theme): string {
  if (theme.dark) return hex

  const rgb = hexToRgb(hex)
  if (!rgb) return hex

  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255
  if (luminance < 0.5) return hex

  // Scaling RGB toward black keeps the hue but drags a pastel's already-low
  // saturation down with it, reading as muted grey rather than a deep colour.
  // Going through HSL and pushing saturation up while pulling lightness down
  // keeps the hue and lands on something vivid — closer to how the same
  // class would look filled solid on the actual Calendar grid.
  const { h, s } = rgbToHsl(rgb)
  return hslToHex(h, Math.max(s, 0.65), 0.4)
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!match) return null
  const value = parseInt(match[1]!, 16)
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }
}

function rgbToHsl({ r, g, b }: { r: number; g: number; b: number }): {
  h: number
  s: number
  l: number
} {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2

  if (max === min) return { h: 0, s: 0, l }

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  switch (max) {
    case rn:
      h = (gn - bn) / d + (gn < bn ? 6 : 0)
      break
    case gn:
      h = (bn - rn) / d + 2
      break
    default:
      h = (rn - gn) / d + 4
  }
  return { h: h / 6, s, l }
}

function hslToHex(h: number, s: number, l: number): string {
  const toChannel = (n: number): number => {
    const k = (n + h * 12) % 12
    const a = s * Math.min(l, 1 - l)
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return rgbToHex(toChannel(0) * 255, toChannel(8) * 255, toChannel(4) * 255)
}

function rgbToHex(r: number, g: number, b: number): string {
  const channel = (n: number) => Math.round(n).toString(16).padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}
