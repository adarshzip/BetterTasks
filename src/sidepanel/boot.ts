/**
 * Blank-screen diagnostics.
 *
 * If the bundle fails to load or throws before React mounts, the panel is a
 * white rectangle and the only clue is in a devtools window most people will
 * not open. This puts the reason on the page instead.
 *
 * It lives in its own module rather than an inline <script> because extension
 * pages run under `script-src 'self'`, which blocks inline execution outright.
 * The first version of this was inline and was silently blocked by CSP, so the
 * safety net was never actually armed.
 *
 * Loaded before main.tsx so its handlers are registered when that module runs.
 */

const BOOT_TIMEOUT_MS = 3000

function show(what: string, detail: unknown): void {
  const boot = document.getElementById('boot')
  if (!boot) return

  boot.textContent = ''

  const heading = document.createElement('strong')
  heading.textContent = what

  const body = document.createElement('pre')
  body.textContent = String(detail)

  boot.append(heading, body)
}

window.addEventListener('error', (event) => {
  show('Script error', event.error?.stack ?? event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason as { stack?: string } | undefined
  show('Unhandled rejection', reason?.stack ?? event.reason)
})

setTimeout(() => {
  const boot = document.getElementById('boot')
  // main.tsx clears this the moment it runs, so surviving text means it never did.
  if (boot?.textContent?.trim() === 'Starting…') {
    show('Module never executed', 'The bundle did not load. Check the console for a CSP or 404 error.')
  }
}, BOOT_TIMEOUT_MS)
