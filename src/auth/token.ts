/**
 * OAuth via launchWebAuthFlow.
 *
 * The obvious API here is chrome.identity.getAuthToken, but that is Chrome
 * only: it reads the Google account the browser itself is signed into, which
 * Edge has no equivalent for. launchWebAuthFlow is implemented by every
 * Chromium browser and just runs a normal OAuth redirect in a popup.
 *
 * We use the implicit flow (response_type=token) rather than authorization
 * code with PKCE, because Google requires a client secret when exchanging a
 * code for a "Web application" client, and a secret shipped inside an
 * extension is trivially extractable and therefore not a secret.
 *
 * The tradeoff is that implicit returns no refresh token. Tokens last an hour
 * and are renewed silently with prompt=none, which works as long as the user
 * has a live Google session in the browser. A useful side effect: with no
 * refresh token, the seven-day Testing-mode expiry does not apply.
 *
 * Runs in the service worker only.
 */

declare const __OAUTH_CLIENT_ID__: string

/**
 * `calendar.events` covers reading and writing events and nothing else:
 * colours, the calendar list, free/busy, and creating a calendar all fail on
 * scopes (SPIKES.md). The broader `calendar` scope is required for those.
 */
const SCOPES = [
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/calendar',
]

/** Renew a little early so a request never sets off mid-flight. */
const EXPIRY_SKEW_MS = 60_000

export class AuthError extends Error {
  constructor(
    message: string,
    readonly interactiveRequired: boolean,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

interface CachedToken {
  token: string
  expiresAt: number
  /** The scopes this token was granted under; see `usable`. */
  scopes?: string
}

/** Identifies the scope set, so a token granted under an older one is dropped. */
const SCOPE_KEY = SCOPES.join(' ')

const CACHE_KEY = 'bettertasks:token'

/**
 * Module scope is only a fast path. The real cache is chrome.storage.session,
 * because the service worker is torn down constantly and a fresh worker would
 * otherwise have to re-authorize on every single wake. Session storage is
 * in-memory and cleared when the browser closes, so the token never touches
 * disk.
 */
let cached: CachedToken | null = null

/**
 * A cached token is only usable if it has not expired AND was granted under the
 * current scope set. Without the scope check, adding a scope leaves a stale
 * token in place that keeps failing with "insufficient authentication scopes",
 * which reads as a broken feature rather than a missing consent.
 */
function usable(entry: CachedToken | null): entry is CachedToken {
  if (!entry || entry.expiresAt <= Date.now() + EXPIRY_SKEW_MS) return false
  return entry.scopes === SCOPE_KEY
}

async function readCache(): Promise<CachedToken | null> {
  if (usable(cached)) return cached
  try {
    const stored = await chrome.storage.session.get(CACHE_KEY)
    const entry = stored[CACHE_KEY] as CachedToken | undefined
    if (usable(entry ?? null)) {
      cached = entry!
      return cached
    }
  } catch {
    // Session storage unavailable; fall through to a fresh authorization.
  }
  return null
}

async function writeCache(entry: CachedToken): Promise<void> {
  cached = entry
  try {
    await chrome.storage.session.set({ [CACHE_KEY]: entry })
  } catch {
    // Losing the shared cache only costs an extra silent renewal.
  }
}

export async function getToken(interactive: boolean): Promise<string> {
  const entry = await readCache()
  if (entry) return entry.token

  // Try silent first even when interactive is allowed: if consent was already
  // granted and the Google session is live, this refreshes with no popup.
  try {
    return await authorize(false)
  } catch (error) {
    if (!interactive) throw error
  }

  return authorize(true)
}

async function authorize(interactive: boolean): Promise<string> {
  const url = buildAuthUrl(interactive)

  let redirect: string | undefined
  try {
    redirect = await chrome.identity.launchWebAuthFlow({ url, interactive })
  } catch (error) {
    // Edge and Chrome both reject here when prompt=none needs interaction.
    throw new AuthError(
      error instanceof Error ? error.message : 'Authorization failed',
      !interactive,
    )
  }

  if (!redirect) {
    throw new AuthError('Authorization was cancelled', !interactive)
  }

  return parseRedirect(redirect, interactive)
}

function buildAuthUrl(interactive: boolean): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', __OAUTH_CLIENT_ID__)
  url.searchParams.set('response_type', 'token')
  url.searchParams.set('redirect_uri', chrome.identity.getRedirectURL())
  url.searchParams.set('scope', SCOPES.join(' '))

  // prompt=none makes the silent path fail fast instead of showing a window
  // that launchWebAuthFlow would refuse to display anyway.
  if (!interactive) url.searchParams.set('prompt', 'none')

  return url.toString()
}

/** The token comes back in the URL fragment, not the query string. */
function parseRedirect(redirect: string, interactive: boolean): string {
  const fragment = new URL(redirect).hash.replace(/^#/, '')
  const params = new URLSearchParams(fragment)

  const error = params.get('error')
  if (error) {
    // Google returns this when prompt=none cannot complete without the user.
    const needsUser = error === 'interaction_required' || error === 'login_required'
    throw new AuthError(error, needsUser || !interactive)
  }

  const token = params.get('access_token')
  if (!token) {
    throw new AuthError('No access token in redirect', !interactive)
  }

  const expiresIn = Number(params.get('expires_in')) || 3600
  void writeCache({ token, expiresAt: Date.now() + expiresIn * 1000, scopes: SCOPE_KEY })

  return token
}

/**
 * Drops a token the server has already rejected, so the next call mints a
 * fresh one instead of replaying a dead token.
 */
export async function invalidateToken(token: string): Promise<void> {
  if (cached?.token === token) cached = null
  try {
    await chrome.storage.session.remove(CACHE_KEY)
  } catch {
    // Nothing to clean up.
  }
}

/** Revokes the grant at Google so the next sign-in asks for consent again. */
export async function signOut(): Promise<void> {
  const token = (await readCache())?.token
  cached = null
  try {
    await chrome.storage.session.remove(CACHE_KEY)
  } catch {
    // Nothing to clean up.
  }
  if (!token) return

  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: 'POST',
    })
  } catch {
    // Local state is already cleared; a failed revoke is not worth surfacing.
  }
}

/** Exposed for the redirect URI shown in SETUP.md. */
export function redirectUri(): string {
  return chrome.identity.getRedirectURL()
}
