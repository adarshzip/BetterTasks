import { AuthError, getToken, invalidateToken } from '@/auth/token'

/** Thrown for any non-2xx that is not an auth problem. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | boolean | undefined>
  interactive?: boolean
}

const MAX_ATTEMPTS = 4

/**
 * Authenticated fetch with three behaviours worth naming:
 *
 * 1. A 401 invalidates the cached token and retries once. Chrome caches tokens
 *    Google may have already revoked.
 * 2. 429 and 5xx back off exponentially. The Tasks API rate limits readily
 *    when the panel refreshes several lists at once.
 * 3. A 204 or empty body resolves to undefined rather than throwing on
 *    JSON.parse. Tasks delete returns an empty body.
 */
export async function apiFetch<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, interactive = false } = options
  const target = new URL(url)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) target.searchParams.set(key, String(value))
  }

  let retriedAuth = false

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const token = await getToken(interactive)
    const response = await fetch(target, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

    if (response.status === 401 && !retriedAuth) {
      retriedAuth = true
      await invalidateToken(token)
      continue
    }

    if (response.status === 401 || response.status === 403) {
      throw new AuthError(await describe(response), true)
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === MAX_ATTEMPTS - 1) {
        throw new ApiError(response.status, await describe(response))
      }
      await sleep(2 ** attempt * 500)
      continue
    }

    if (!response.ok) {
      throw new ApiError(response.status, await describe(response))
    }

    if (response.status === 204) return undefined as T
    const text = await response.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  throw new ApiError(0, 'Request failed after retries')
}

async function describe(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: { message?: string } }
    if (data.error?.message) return data.error.message
  } catch {
    // Fall through to the status text.
  }
  return `${response.status} ${response.statusText}`
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
