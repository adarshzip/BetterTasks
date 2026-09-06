/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Imported per test rather than at the top.
 *
 * The module keeps an in-memory token cache, and a static import binds it once
 * for the whole file, so one test's cached token would satisfy the next and
 * hide whether a renewal actually happened.
 */
const loadGetToken = async () => (await import('./token')).getToken

/** A redirect carrying a fresh token, as Google would return it. */
const redirect = (token = 'tok') =>
  `https://abc.chromiumapp.org/#access_token=${token}&expires_in=3600&token_type=Bearer`

let flows: number
let store: Record<string, unknown>

beforeEach(() => {
  vi.resetModules()
  flows = 0
  store = {}

  vi.stubGlobal('chrome', {
    identity: {
      getRedirectURL: () => 'https://abc.chromiumapp.org/',
      launchWebAuthFlow: vi.fn(async () => {
        flows += 1
        // Slow enough that parallel callers overlap.
        await new Promise((r) => setTimeout(r, 10))
        return redirect()
      }),
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(store, values)),
        remove: vi.fn(async () => undefined),
      },
    },
  })

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ email: 'a@b.com' }) })),
  )
})

describe('getToken', () => {
  it('returns the token from the redirect fragment', async () => {
    const getToken = await loadGetToken()
    await expect(getToken(false)).resolves.toBe('tok')
  })

  // Loading fires one request per task list in parallel. Without sharing the
  // renewal, an expired token starts a separate auth flow for every one.
  it('shares one renewal across concurrent callers', async () => {
    const getToken = await loadGetToken()
    const tokens = await Promise.all([getToken(false), getToken(false), getToken(false)])

    expect(tokens).toEqual(['tok', 'tok', 'tok'])
    expect(flows).toBe(1)
  })

  it('caches, so a later call starts no flow at all', async () => {
    const getToken = await loadGetToken()
    await getToken(false)
    await getToken(false)
    expect(flows).toBe(1)
  })

  // A failed renewal must not be handed to the next caller.
  it('does not reuse a failed renewal', async () => {
    const getToken = await loadGetToken()
    const identity = (globalThis as unknown as { chrome: { identity: { launchWebAuthFlow: ReturnType<typeof vi.fn> } } }).chrome.identity
    identity.launchWebAuthFlow.mockImplementationOnce(async () => {
      flows += 1
      throw new Error('interaction_required')
    })

    await expect(getToken(false)).rejects.toThrow()
    await expect(getToken(false)).resolves.toBe('tok')
    expect(flows).toBe(2)
  })
})
