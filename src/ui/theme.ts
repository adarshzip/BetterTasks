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
