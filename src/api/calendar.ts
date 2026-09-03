import { apiFetch } from './http'

const BASE = 'https://www.googleapis.com/calendar/v3'

/**
 * Calendar API client, mirroring src/api/tasks.ts.
 *
 * Only raw API JSON is returned. Events are far more date-heavy than tasks, and
 * these values cross the service worker's JSON boundary, where a Date silently
 * becomes a string. Conversion happens on the panel side.
 */

export interface WireEvent {
  id: string
  summary?: string
  description?: string
  colorId?: string
  status?: 'confirmed' | 'tentative' | 'cancelled'
  /** Timed events carry `dateTime`; all-day events carry `date` instead. */
  start?: { dateTime?: string; date?: string; timeZone?: string }
  end?: { dateTime?: string; date?: string; timeZone?: string }
  recurringEventId?: string
  htmlLink?: string
  extendedProperties?: { private?: Record<string, string> }
}

export interface WireCalendar {
  id: string
  summary?: string
  backgroundColor?: string
  primary?: boolean
}

interface Page<T> {
  items?: T[]
  nextPageToken?: string
}

export async function listEvents(
  calendarId: string,
  range: { timeMin: string; timeMax: string },
): Promise<WireEvent[]> {
  const events = await collect<WireEvent>(
    `${BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      timeMin: range.timeMin,
      timeMax: range.timeMax,
      // Expands recurring events into instances, which is what a day view needs.
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    },
  )
  return events.filter((e) => e.status !== 'cancelled')
}

/** The colour palette: maps a `colorId` to the hex value Calendar renders. */
export async function getColors(): Promise<{
  event: Record<string, { background: string; foreground: string }>
  calendar: Record<string, { background: string; foreground: string }>
}> {
  return apiFetch(`${BASE}/colors`)
}

export async function listCalendars(): Promise<WireCalendar[]> {
  return collect<WireCalendar>(`${BASE}/users/me/calendarList`, { maxResults: 250 })
}

export async function createCalendar(summary: string): Promise<WireCalendar> {
  return apiFetch<WireCalendar>(`${BASE}/calendars`, { method: 'POST', body: { summary } })
}

/**
 * Adds a calendar to the user's list and marks it selected.
 *
 * `calendars.insert` creates a calendar but leaves it out of the sidebar, so a
 * newly created work calendar exists and is invisible, which looks exactly
 * like nothing having happened.
 */
export async function subscribeCalendar(calendarId: string): Promise<WireCalendar> {
  return apiFetch<WireCalendar>(`${BASE}/users/me/calendarList`, {
    method: 'POST',
    body: { id: calendarId, selected: true },
  })
}

export async function insertEvent(
  calendarId: string,
  event: Partial<WireEvent>,
): Promise<WireEvent> {
  return apiFetch<WireEvent>(`${BASE}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: event,
  })
}

export async function patchEvent(
  calendarId: string,
  eventId: string,
  patch: Partial<WireEvent>,
): Promise<WireEvent> {
  return apiFetch<WireEvent>(
    `${BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'PATCH', body: patch },
  )
}

/**
 * Deleting an event that is already gone returns 404. That is not an error
 * worth surfacing: the desired state has been reached either way.
 */
export async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  try {
    await apiFetch<void>(
      `${BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE' },
    )
  } catch (error) {
    if (!isNotFound(error)) throw error
  }
}

/** Fetches one event, returning null when it has been deleted elsewhere. */
export async function getEvent(calendarId: string, eventId: string): Promise<WireEvent | null> {
  try {
    return await apiFetch<WireEvent>(
      `${BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    )
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
}

export async function freeBusy(
  calendarIds: string[],
  range: { timeMin: string; timeMax: string },
): Promise<Record<string, { busy?: { start: string; end: string }[] }>> {
  const response = await apiFetch<{
    calendars?: Record<string, { busy?: { start: string; end: string }[] }>
  }>(`${BASE}/freeBusy`, {
    method: 'POST',
    body: { ...range, items: calendarIds.map((id) => ({ id })) },
  })
  return response.calendars ?? {}
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 404
}

async function collect<T>(
  url: string,
  query: Record<string, string | number | boolean | undefined>,
): Promise<T[]> {
  const out: T[] = []
  let pageToken: string | undefined

  do {
    const page = await apiFetch<Page<T>>(url, { query: { ...query, pageToken } })
    out.push(...(page.items ?? []))
    pageToken = page.nextPageToken
  } while (pageToken)

  return out
}
