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
 * scopes (docs/SPIKES.md). The broader `calendar` scope is required for those.
 */
const SCOPES = [
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/calendar',
  // Not for reading mail or a profile: this exists purely so silent renewals
  // can name the account. Without it Google answers `interaction_required`,
  // because with more than one signed-in account it will not guess.
  'https://www.googleapis.com/auth/userinfo.email',
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
const ACCOUNT_KEY = 'bettertasks:account'

/** Where the token lives; see the note on the cache below. */
const store = (): chrome.storage.StorageArea => chrome.storage.local

/**
 * Module scope is only a fast path. The real cache is chrome.storage.local,
 * because the service worker is torn down constantly and a fresh worker would
 * otherwise re-authorize on every wake.
 *
 * `local` rather than `session`: session storage is cleared when the browser
 * closes, which meant every Edge restart began with no token and, when the
 * silent renewal failed, a visible sign-in prompt.
 *
 * The tradeoff is that an access token now rests on disk in the extension's
 * own storage area. It is scoped to Tasks and Calendar, expires in an hour,
 * and is cleared on sign-out. Anyone who can read it can already read the
 * browser profile it lives in.
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
    const stored = await store().get(CACHE_KEY)
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
    await store().set({ [CACHE_KEY]: entry })
  } catch {
    // Losing the shared cache only costs an extra silent renewal.
  }
}

/**
 * A silent renewal already under way, shared by every caller that arrives
 * while it runs.
 *
 * Loading fires one request per task list in parallel, so an expired token
 * would otherwise start a separate authorization flow for each of them at the
 * same moment. Interactive sign-in is deliberately not shared: it is rare,
 * user-initiated, and should not be handed a flow someone else started.
 */
let silentRenewal: Promise<string> | null = null

function renewSilently(): Promise<string> {
  if (!silentRenewal) {
    silentRenewal = authorize(false)
    // Cleared however it settles, so a failure does not poison later attempts.
    void silentRenewal.catch(() => undefined).then(() => {
      silentRenewal = null
    })
  }
  return silentRenewal
}

export async function getToken(interactive: boolean): Promise<string> {
  const entry = await readCache()
  if (entry) return entry.token

  // Try silent first even when interactive is allowed: if consent was already
  // granted and the Google session is live, this refreshes with no popup.
  try {
    return await renewSilently()
  } catch (error) {
    if (!interactive) throw error
  }

  return authorize(true)
}

async function authorize(interactive: boolean): Promise<string> {
  const url = buildAuthUrl(interactive, await readAccount())

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

function buildAuthUrl(interactive: boolean, account: string | null): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', __OAUTH_CLIENT_ID__)
  url.searchParams.set('response_type', 'token')
  url.searchParams.set('redirect_uri', chrome.identity.getRedirectURL())
  url.searchParams.set('scope', SCOPES.join(' '))

  // Naming the account is what lets a silent renewal succeed. Without it,
  // Google refuses to choose between signed-in accounts and returns
  // `interaction_required`, which surfaces as a sign-in prompt on every
  // browser restart.
  if (account) url.searchParams.set('login_hint', account)

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

  // Learn the account once, so every later renewal can be silent.
  void rememberAccount(token)

  return token
}

async function readAccount(): Promise<string | null> {
  try {
    const stored = await store().get(ACCOUNT_KEY)
    const email = stored[ACCOUNT_KEY]
    return typeof email === 'string' && email ? email : null
  } catch {
    return null
  }
}

/**
 * Records which account granted the token.
 *
 * Best-effort: if this fails the extension still works, it just falls back to
 * asking the user to sign in when a silent renewal is refused.
 */
async function rememberAccount(token: string): Promise<void> {
  if (await readAccount()) return

  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return

    const info = (await response.json()) as { email?: string }
    if (info.email) await store().set({ [ACCOUNT_KEY]: info.email })
  } catch {
    // No hint available; silent renewal may need a sign-in instead.
  }
}

/**
 * Drops a token the server has already rejected, so the next call mints a
 * fresh one instead of replaying a dead token.
 */
export async function invalidateToken(token: string): Promise<void> {
  if (cached?.token === token) cached = null
  try {
    await store().remove(CACHE_KEY)
  } catch {
    // Nothing to clean up.
  }
}

/** Revokes the grant at Google so the next sign-in asks for consent again. */
export async function signOut(): Promise<void> {
  const token = (await readCache())?.token
  cached = null
  try {
    // The account hint goes too: signing out should not leave the next user of
    // this browser silently pinned to the previous account.
    await store().remove([CACHE_KEY, ACCOUNT_KEY])
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

/** Exposed for the redirect URI shown in docs/SETUP.md. */
export function redirectUri(): string {
  return chrome.identity.getRedirectURL()
}
